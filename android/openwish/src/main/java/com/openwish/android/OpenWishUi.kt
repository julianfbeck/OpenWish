package com.openwish.android

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.StringRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddAPhoto
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream

// ---------------------------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------------------------

/** The "App bug / Card or detection" switch only exists when the app can search its cards. */
internal fun showsIssueKindSwitch(configuration: OpenWishConfiguration): Boolean =
    configuration.cardSearchProvider != null

/** Feature-board columns: server state to its label. */
internal val featureStates: List<Pair<String, Int>> = listOf(
    "pending" to R.string.openwish_wish_pending,
    "inReview" to R.string.openwish_wish_inReview,
    "planned" to R.string.openwish_wish_planned,
    "inProgress" to R.string.openwish_wish_inProgress,
    "completed" to R.string.openwish_wish_completed,
)

/** Legacy WishKit states share a column: `approved` shows as In review, `implemented` as Completed. */
internal fun featureColumn(state: String): String = when (state) {
    "approved" -> "inReview"
    "implemented" -> "completed"
    else -> state
}

internal fun OpenWishFeature.belongsTo(column: String): Boolean = featureColumn(state) == column

@StringRes
internal fun featureStateLabel(state: String): Int? =
    featureStates.firstOrNull { (column, _) -> column == featureColumn(state) }?.second

@StringRes
internal fun OpenWishErrorKind.issueMessage(): Int = when (this) {
    OpenWishErrorKind.INVALID_EMAIL -> R.string.openwish_bug_emailInvalid
    OpenWishErrorKind.IMAGE_LOAD -> R.string.openwish_bug_errorPrepare
    OpenWishErrorKind.IMAGE_TOO_LARGE -> R.string.openwish_bug_errorTooLarge
    OpenWishErrorKind.UPLOAD -> R.string.openwish_bug_errorUpload
    OpenWishErrorKind.INVALID_INPUT, OpenWishErrorKind.REQUEST -> R.string.openwish_bug_errorSend
}

// ---------------------------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------------------------

@Composable
internal fun OpenWishFullScreenDialog(
    onDismissRequest: () -> Unit,
    title: String,
    bottomBar: (@Composable RowScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(
        onDismissRequest = onDismissRequest,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
        ),
    ) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).imePadding()) {
                Row(
                    Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        title,
                        style = MaterialTheme.typography.titleLarge,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = onDismissRequest) { Text(stringResource(R.string.openwish_wish_close)) }
                }
                HorizontalDivider()
                Column(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp)) { content() }
                if (bottomBar != null) {
                    HorizontalDivider()
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                        verticalAlignment = Alignment.CenterVertically,
                        content = bottomBar,
                    )
                }
            }
        }
    }
}

@Composable
internal fun ErrorWithRetry(message: String, onRetry: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
        TextButton(onClick = onRetry) { Text(stringResource(R.string.openwish_common_retry)) }
    }
}

@Composable
internal fun CenteredProgress() {
    Box(Modifier.fillMaxWidth().padding(top = 24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
}

@Composable
internal fun CommentBubble(label: String, comment: OpenWishComment) {
    Surface(
        color = if (comment.isAdmin) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                Text(formatOpenWishDate(comment.createdAt), style = MaterialTheme.typography.labelSmall)
            }
            Text(comment.description, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

internal fun formatOpenWishDate(iso: String): String = runCatching {
    java.time.format.DateTimeFormatter.ofLocalizedDate(java.time.format.FormatStyle.MEDIUM)
        .withZone(java.time.ZoneId.systemDefault())
        .format(java.time.Instant.parse(iso))
}.getOrElse { iso.take(10) }

// ---------------------------------------------------------------------------------------------
// Feature requests
// ---------------------------------------------------------------------------------------------

@Composable
public fun OpenWishFeatureDialog(onDismiss: () -> Unit) {
    val client = remember { OpenWish.requireClient() }
    val scope = rememberCoroutineScope()
    var selectedState by remember { mutableStateOf("pending") }
    var features by remember { mutableStateOf<List<OpenWishFeature>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var loadFailed by remember { mutableStateOf(false) }
    var voteFailed by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    var submitting by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var formError by remember { mutableStateOf<OpenWishErrorKind?>(null) }
    var detailId by remember { mutableStateOf<String?>(null) }

    suspend fun reload() {
        runCatching { client.features() }
            .onSuccess { features = it.list; loadFailed = false }
            .onFailure { loadFailed = true }
        loading = false
    }
    fun vote(feature: OpenWishFeature) {
        scope.launch {
            voteFailed = false
            runCatching { client.vote(feature.id) }
                .onSuccess { reload() }
                .onFailure { voteFailed = true }
        }
    }
    LaunchedEffect(Unit) { reload() }

    val detail = detailId?.let { id -> features.firstOrNull { it.id == id } }
    BackHandler(enabled = adding || detail != null) {
        if (adding) { adding = false; formError = null } else detailId = null
    }

    OpenWishFullScreenDialog(
        onDismissRequest = onDismiss,
        title = stringResource(R.string.openwish_feature_requestTitle),
        bottomBar = {
            when {
                adding -> {
                    TextButton(onClick = { adding = false; formError = null }) { Text(stringResource(R.string.openwish_common_back)) }
                    Button(
                        enabled = title.isNotBlank() && description.isNotBlank() && !submitting,
                        onClick = {
                            scope.launch {
                                submitting = true; formError = null
                                runCatching { client.createFeature(title, description, email) }
                                    .onSuccess {
                                        adding = false; title = ""; description = ""; email = ""
                                        selectedState = "pending"
                                        reload()
                                    }
                                    .onFailure { formError = it.openWishErrorKind() }
                                submitting = false
                            }
                        },
                    ) { Text(stringResource(R.string.openwish_feature_send)) }
                }
                detail != null -> TextButton(onClick = { detailId = null }) { Text(stringResource(R.string.openwish_common_back)) }
                else -> Button(onClick = { adding = true }) { Text(stringResource(R.string.openwish_feature_request)) }
            }
        },
    ) {
        when {
            adding -> Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedTextField(
                    title, { title = it.take(50) },
                    label = { Text(stringResource(R.string.openwish_wish_title)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    description, { description = it.take(500) },
                    label = { Text(stringResource(R.string.openwish_feature_descriptionHint)) },
                    minLines = 4,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    email, { email = it; if (formError == OpenWishErrorKind.INVALID_EMAIL) formError = null },
                    label = { Text(stringResource(R.string.openwish_wish_emailOptional)) },
                    isError = formError == OpenWishErrorKind.INVALID_EMAIL,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    modifier = Modifier.fillMaxWidth(),
                )
                formError?.let { kind ->
                    val message = if (kind == OpenWishErrorKind.INVALID_EMAIL) R.string.openwish_bug_emailInvalid
                    else R.string.openwish_feature_errorSend
                    Text(stringResource(message), color = MaterialTheme.colorScheme.error)
                }
                if (submitting) CenteredProgress()
            }
            detail != null -> FeatureDetail(
                feature = detail,
                voted = detail.votingUsers.any { it.uuid == client.userUuid },
                voteFailed = voteFailed,
                onVote = { vote(detail) },
                onComment = { text -> client.comment(detail.id, text); reload() },
            )
            else -> {
                Text(stringResource(R.string.openwish_feature_intro), style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.size(8.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(featureStates, key = { it.first }) { (state, label) ->
                        FilterChip(
                            selected = selectedState == state,
                            onClick = { selectedState = state },
                            label = { Text(stringResource(label)) },
                        )
                    }
                }
                if (voteFailed) Text(stringResource(R.string.openwish_wish_voteFailed), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.size(8.dp))
                val visible = features.filter { it.belongsTo(selectedState) }
                when {
                    loading -> CenteredProgress()
                    loadFailed -> ErrorWithRetry(stringResource(R.string.openwish_feature_loadError)) {
                        loading = true
                        scope.launch { reload() }
                    }
                    visible.isEmpty() -> Text(
                        stringResource(R.string.openwish_wish_noFeatureRequests),
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(top = 24.dp).align(Alignment.CenterHorizontally),
                    )
                    else -> LazyColumn(Modifier.fillMaxWidth().weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(visible, key = { it.id }) { feature ->
                            Card(Modifier.fillMaxWidth().clickable { detailId = feature.id }) {
                                Column(Modifier.padding(start = 12.dp, end = 12.dp, top = 12.dp)) {
                                    Text(feature.title, style = MaterialTheme.typography.titleMedium)
                                    Text(feature.description, style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis)
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        VoteButton(feature, voted = feature.votingUsers.any { it.uuid == client.userUuid }) { vote(feature) }
                                        if (feature.commentList.isNotEmpty()) {
                                            Spacer(Modifier.width(12.dp))
                                            Icon(
                                                Icons.Outlined.ChatBubbleOutline,
                                                contentDescription = stringResource(R.string.openwish_wish_comments),
                                                modifier = Modifier.size(16.dp),
                                            )
                                            Text(" ${feature.commentList.size}", style = MaterialTheme.typography.labelMedium)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun VoteButton(feature: OpenWishFeature, voted: Boolean, onVote: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onVote) {
            Icon(
                if (voted) Icons.Filled.ThumbUp else Icons.Outlined.ThumbUp,
                contentDescription = stringResource(R.string.openwish_wish_upvote),
                tint = if (voted) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            stringResource(R.string.openwish_feature_voteCount, feature.votingUsers.size),
            style = MaterialTheme.typography.labelMedium,
        )
    }
}

@Composable
private fun FeatureDetail(
    feature: OpenWishFeature,
    voted: Boolean,
    voteFailed: Boolean,
    onVote: () -> Unit,
    onComment: suspend (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var comment by remember(feature.id) { mutableStateOf("") }
    var sending by remember(feature.id) { mutableStateOf(false) }
    var commentFailed by remember(feature.id) { mutableStateOf(false) }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(feature.title, style = MaterialTheme.typography.titleLarge)
        featureStateLabel(feature.state)?.let { label ->
            Text(stringResource(label), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
        }
        Text(feature.description, style = MaterialTheme.typography.bodyMedium)
        VoteButton(feature, voted, onVote)
        if (voteFailed) Text(stringResource(R.string.openwish_wish_voteFailed), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        HorizontalDivider()
        Text(stringResource(R.string.openwish_wish_comments), style = MaterialTheme.typography.titleMedium)
        if (feature.commentList.isEmpty()) {
            Text(stringResource(R.string.openwish_feature_noComments), style = MaterialTheme.typography.bodySmall)
        }
        feature.commentList.forEach { item ->
            CommentBubble(
                label = stringResource(if (item.isAdmin) R.string.openwish_wish_admin else R.string.openwish_wish_user),
                comment = item,
            )
        }
        OutlinedTextField(
            comment, { comment = it.take(2_000); commentFailed = false },
            placeholder = { Text(stringResource(R.string.openwish_wish_writeAComment)) },
            minLines = 2,
            modifier = Modifier.fillMaxWidth(),
        )
        if (commentFailed) Text(stringResource(R.string.openwish_feature_commentFailed), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
            if (sending) CircularProgressIndicator(Modifier.size(24.dp).padding(end = 8.dp))
            Button(
                enabled = comment.isNotBlank() && !sending,
                onClick = {
                    scope.launch {
                        sending = true; commentFailed = false
                        runCatching { onComment(comment) }
                            .onSuccess { comment = "" }
                            .onFailure { commentFailed = true }
                        sending = false
                    }
                },
            ) { Text(stringResource(R.string.openwish_feature_send)) }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Issue reports
// ---------------------------------------------------------------------------------------------

@Composable
public fun OpenWishIssueDialog(onDismiss: () -> Unit) {
    val client = remember { OpenWish.requireClient() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val showsKindSwitch = remember(client) { showsIssueKindSwitch(client.configuration) }
    var kind by remember { mutableStateOf(IssueKind.BUG) }
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var cardQuery by remember { mutableStateOf("") }
    var cards by remember { mutableStateOf<List<OpenWishCard>?>(null) }
    var searching by remember { mutableStateOf(false) }
    var selectedCard by remember { mutableStateOf<OpenWishCard?>(null) }
    var attachments by remember { mutableStateOf<List<OpenWishAttachment>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<Int?>(null) }
    var emailInvalid by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf(false) }
    var showReports by remember { mutableStateOf(false) }
    val isCardReport = showsKindSwitch && kind == IssueKind.CARD_DATA
    val limitReached = attachments.size >= OpenWishClient.MAX_ATTACHMENTS

    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        runCatching {
            val type = context.contentResolver.getType(uri) ?: "image/jpeg"
            val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            OpenWishAttachment(checkNotNull(bytes), type)
        }.onSuccess { attachments = (attachments + it).take(OpenWishClient.MAX_ATTACHMENTS) }
            .onFailure { error = R.string.openwish_bug_errorPhotoLoad }
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap: Bitmap? ->
        bitmap ?: return@rememberLauncherForActivityResult
        val output = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 90, output)
        attachments = (attachments + OpenWishAttachment(output.toByteArray())).take(OpenWishClient.MAX_ATTACHMENTS)
    }

    fun searchCards() {
        if (cardQuery.isBlank()) return
        scope.launch {
            searching = true
            cards = runCatching { client.searchCards(cardQuery.trim()) }.getOrDefault(emptyList())
            searching = false
        }
    }

    OpenWishFullScreenDialog(
        onDismissRequest = onDismiss,
        title = stringResource(R.string.openwish_bug_navReportProblem),
        bottomBar = {
            if (sent) {
                Button(onClick = onDismiss) { Text(stringResource(R.string.openwish_wish_close)) }
            } else {
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.openwish_wish_cancel)) }
                Button(
                    enabled = !loading && title.isNotBlank() && description.isNotBlank(),
                    onClick = {
                        scope.launch {
                            loading = true; error = null; emailInvalid = false
                            runCatching {
                                client.createIssue(
                                    title, description, email,
                                    if (isCardReport) IssueKind.CARD_DATA else IssueKind.BUG,
                                    selectedCard.takeIf { isCardReport }, attachments,
                                )
                            }.onSuccess { sent = true }
                                .onFailure {
                                    val errorKind = it.openWishErrorKind()
                                    emailInvalid = errorKind == OpenWishErrorKind.INVALID_EMAIL
                                    error = errorKind.issueMessage()
                                }
                            loading = false
                        }
                    },
                ) {
                    Text(stringResource(if (isCardReport) R.string.openwish_bug_sendCard else R.string.openwish_bug_sendBug))
                }
            }
        },
    ) {
        if (sent) {
            Column(
                Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
            ) {
                Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(56.dp))
                Text(stringResource(R.string.openwish_bug_sent), style = MaterialTheme.typography.titleMedium)
                OutlinedButton(onClick = { showReports = true }) { Text(stringResource(R.string.openwish_reports_myReports)) }
            }
        } else Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            TextButton(onClick = { showReports = true }, modifier = Modifier.align(Alignment.End)) {
                Icon(Icons.Filled.History, contentDescription = null, modifier = Modifier.size(18.dp))
                Text(" " + stringResource(R.string.openwish_reports_myReports))
            }
            if (showsKindSwitch) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = kind == IssueKind.BUG,
                        onClick = { kind = IssueKind.BUG; selectedCard = null },
                        label = { Text(stringResource(R.string.openwish_bug_kindBug)) },
                    )
                    FilterChip(
                        selected = kind == IssueKind.CARD_DATA,
                        onClick = { kind = IssueKind.CARD_DATA },
                        label = { Text(stringResource(R.string.openwish_bug_kindCard)) },
                    )
                }
            }
            OutlinedTextField(
                title, { title = it.take(80) },
                label = { Text(stringResource(R.string.openwish_bug_fieldTitle)) },
                placeholder = { Text(stringResource(R.string.openwish_bug_titlePlaceholder)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                description, { description = it.take(2_000) },
                label = { Text(stringResource(R.string.openwish_bug_fieldDescription)) },
                placeholder = {
                    Text(stringResource(if (isCardReport) R.string.openwish_bug_cardDescriptionPlaceholder else R.string.openwish_bug_descriptionPlaceholder))
                },
                minLines = 4,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                email, { email = it; emailInvalid = false },
                label = { Text(optionalLabel(R.string.openwish_bug_fieldEmail)) },
                isError = emailInvalid,
                supportingText = {
                    Text(stringResource(if (emailInvalid) R.string.openwish_bug_emailInvalid else R.string.openwish_bug_emailHint))
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier.fillMaxWidth(),
            )
            if (isCardReport) {
                Text(optionalLabel(R.string.openwish_bug_affectedCard), style = MaterialTheme.typography.titleSmall)
                val card = selectedCard
                if (card != null) {
                    Card(Modifier.fillMaxWidth()) {
                        Row(Modifier.padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                            Text(card.displayName(), Modifier.weight(1f).padding(horizontal = 8.dp))
                            TextButton(onClick = { selectedCard = null }) { Text(stringResource(R.string.openwish_bug_changeCard)) }
                        }
                    }
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            cardQuery, { cardQuery = it },
                            placeholder = { Text(stringResource(R.string.openwish_bug_cardSearchPlaceholder)) },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                            keyboardActions = KeyboardActions(onSearch = { searchCards() }),
                            modifier = Modifier.weight(1f),
                        )
                        OutlinedButton(enabled = cardQuery.isNotBlank() && !searching, onClick = { searchCards() }) {
                            Text(stringResource(R.string.openwish_bug_cardSearch))
                        }
                    }
                    if (searching) CenteredProgress()
                    cards?.let { results ->
                        if (results.isEmpty()) Text(stringResource(R.string.openwish_bug_cardNoResults), style = MaterialTheme.typography.bodySmall)
                        results.take(6).forEach { result ->
                            Card(Modifier.fillMaxWidth().clickable { selectedCard = result }) {
                                Text(result.displayName(), Modifier.padding(10.dp))
                            }
                        }
                    }
                }
            }
            Text(optionalLabel(R.string.openwish_bug_screenshots), style = MaterialTheme.typography.titleSmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(enabled = !limitReached, onClick = { camera.launch(null) }) {
                    Icon(Icons.Filled.AddAPhoto, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text(" " + stringResource(if (isCardReport) R.string.openwish_bug_photographCard else R.string.openwish_bug_takePhoto))
                }
                OutlinedButton(
                    enabled = !limitReached,
                    onClick = { gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                ) {
                    Icon(Icons.Filled.PhotoLibrary, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text(" " + stringResource(R.string.openwish_bug_addScreenshot))
                }
            }
            if (attachments.isNotEmpty()) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(attachments.size) { index ->
                        AttachmentThumbnail(attachments[index]) {
                            attachments = attachments.filterIndexed { i, _ -> i != index }
                        }
                    }
                }
                Text(
                    stringResource(R.string.openwish_bug_imagesAttached, attachments.size) +
                        if (limitReached) " · " + stringResource(R.string.openwish_bug_limitReached) else "",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            error?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.error) }
            if (loading) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CircularProgressIndicator(Modifier.size(20.dp))
                    if (attachments.isNotEmpty()) Text(stringResource(R.string.openwish_bug_uploading, attachments.size))
                }
            }
        }
    }

    if (showReports) {
        OpenWishReportsDialog(onDismiss = { showReports = false }, onNewReport = { showReports = false })
    }
}

@Composable
private fun optionalLabel(@StringRes label: Int): String =
    "${stringResource(label)} (${stringResource(R.string.openwish_bug_optional)})"

private fun OpenWishCard.displayName(): String = buildString {
    append(name)
    setName?.takeIf { it.isNotBlank() }?.let { append(" · ").append(it) }
    number?.takeIf { it.isNotBlank() }?.let { append(" #").append(it) }
}

@Composable
private fun AttachmentThumbnail(attachment: OpenWishAttachment, onRemove: () -> Unit) {
    val bitmap = remember(attachment) { decodeThumbnail(attachment.bytes) }
    Box(Modifier.size(72.dp)) {
        if (bitmap != null) {
            Image(
                bitmap.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Crop,
                modifier = Modifier.matchParentSize().clip(RoundedCornerShape(8.dp)),
            )
        } else {
            Surface(Modifier.matchParentSize(), shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.surfaceVariant) {}
        }
        Surface(
            shape = RoundedCornerShape(50),
            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.8f),
            modifier = Modifier.align(Alignment.TopEnd).padding(2.dp).size(24.dp),
        ) {
            IconButton(onClick = onRemove) {
                Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.openwish_bug_removeScreenshot), modifier = Modifier.size(16.dp))
            }
        }
    }
}

private fun decodeThumbnail(bytes: ByteArray): Bitmap? = runCatching {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 256) sample *= 2
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
}.getOrNull()
