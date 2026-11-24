package com.openwish.android

import androidx.activity.compose.BackHandler
import androidx.annotation.StringRes
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@StringRes
internal fun issueStateLabel(state: String): Int? = when (state) {
    "open" -> R.string.openwish_reports_stateOpen
    "confirmed" -> R.string.openwish_reports_stateConfirmed
    "inProgress" -> R.string.openwish_reports_stateInProgress
    "fixed" -> R.string.openwish_reports_stateFixed
    "wontFix" -> R.string.openwish_reports_stateWontFix
    "duplicate" -> R.string.openwish_reports_stateDuplicate
    else -> null
}

private fun issueStateColor(state: String): Color = when (state) {
    "open" -> Color(0xFFE67E22)
    "confirmed" -> Color(0xFF2F80ED)
    "inProgress" -> Color(0xFF8E44AD)
    "fixed" -> Color(0xFF27AE60)
    else -> Color(0xFF7F8C8D)
}

/**
 * The reports this installation filed, newest first, with their state and the conversation with
 * the project's admins. [onNewReport] adds a "Report a new bug" button when the caller can open
 * the issue form.
 */
@Composable
public fun OpenWishReportsDialog(onDismiss: () -> Unit, onNewReport: (() -> Unit)? = null) {
    val client = remember { OpenWish.requireClient() }
    val scope = rememberCoroutineScope()
    var issues by remember { mutableStateOf<List<OpenWishIssue>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var loadFailed by remember { mutableStateOf(false) }
    var detailId by remember { mutableStateOf<String?>(null) }

    suspend fun reload() {
        loading = true
        runCatching { client.issues() }
            .onSuccess { issues = it; loadFailed = false }
            .onFailure { loadFailed = true }
        loading = false
    }
    LaunchedEffect(Unit) { reload() }

    val detail = detailId?.let { id -> issues.firstOrNull { it.id == id } }
    BackHandler(enabled = detail != null) { detailId = null }

    OpenWishFullScreenDialog(
        onDismissRequest = onDismiss,
        title = stringResource(R.string.openwish_reports_myReports),
        bottomBar = when {
            detail != null -> ({ TextButton(onClick = { detailId = null }) { Text(stringResource(R.string.openwish_common_back)) } })
            onNewReport != null -> ({ Button(onClick = onNewReport) { Text(stringResource(R.string.openwish_reports_new)) } })
            else -> null
        },
    ) {
        when {
            detail != null -> ReportDetail(detail)
            loading && issues.isEmpty() -> CenteredProgress()
            loadFailed -> ErrorWithRetry(stringResource(R.string.openwish_reports_loadError)) { scope.launch { reload() } }
            issues.isEmpty() -> Text(
                stringResource(R.string.openwish_reports_empty),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 24.dp).align(Alignment.CenterHorizontally),
            )
            else -> LazyColumn(Modifier.fillMaxWidth().weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(issues, key = { it.id }) { issue ->
                    ReportRow(issue) { detailId = issue.id }
                }
            }
        }
    }
}

@Composable
private fun StatePill(state: String) {
    val label = issueStateLabel(state)?.let { stringResource(it) } ?: state.replaceFirstChar { it.uppercase() }
    Surface(color = issueStateColor(state), shape = RoundedCornerShape(50)) {
        Text(
            label,
            color = Color.White,
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

@Composable
private fun AdminRepliedBadge(count: Int) {
    if (count <= 0) return
    Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(50)) {
        Text(
            if (count == 1) stringResource(R.string.openwish_reports_adminReplied)
            else stringResource(R.string.openwish_reports_adminRepliedCount, count),
            color = MaterialTheme.colorScheme.onPrimaryContainer,
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

@Composable
private fun ReportRow(issue: OpenWishIssue, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    issue.title,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                StatePill(issue.state)
            }
            Text(issue.description, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(formatOpenWishDate(issue.createdAt), style = MaterialTheme.typography.labelSmall)
                AdminRepliedBadge(adminReplyCount(issue.commentList))
            }
        }
    }
}

@Composable
private fun ReportDetail(issue: OpenWishIssue) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(issue.title, style = MaterialTheme.typography.titleLarge)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatePill(issue.state)
            Text(formatOpenWishDate(issue.createdAt), style = MaterialTheme.typography.labelMedium)
        }
        issue.card?.let { card ->
            Text(
                "${stringResource(R.string.openwish_bug_affectedCard)}: ${card.name}" +
                    listOfNotNull(card.setName, card.number?.let { "#$it" }).joinToString(" ", prefix = " "),
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Text(issue.description, style = MaterialTheme.typography.bodyMedium)
        HorizontalDivider()
        Text(stringResource(R.string.openwish_reports_conversation), style = MaterialTheme.typography.titleMedium)
        if (issue.commentList.isEmpty()) {
            Text(stringResource(R.string.openwish_reports_noReplies), style = MaterialTheme.typography.bodySmall)
        }
        issue.commentList.forEach { comment ->
            CommentBubble(
                label = stringResource(if (comment.isAdmin) R.string.openwish_wish_admin else R.string.openwish_reports_you),
                comment = comment,
            )
        }
    }
}
