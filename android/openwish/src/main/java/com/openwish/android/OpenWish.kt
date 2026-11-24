package com.openwish.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.UUID
import kotlin.math.roundToInt

/** The SDK version. It equals the OpenWish repository tag shared with the Swift package. */
public object OpenWishSdk {
    public const val VERSION: String = "1.2.0"
    internal const val NAME: String = "openwish-android"
}

public enum class OpenWishApiVersion { AUTOMATIC, V1, V2 }

@Serializable
public enum class IssueKind {
    @SerialName("bug") BUG,
    @SerialName("cardData") CARD_DATA,
}

@Serializable
public data class OpenWishCard(
    val id: String,
    val name: String,
    val setName: String? = null,
    val number: String? = null,
    val imageUrl: String? = null,
    val metadata: JsonObject = JsonObject(emptyMap()),
)

public data class OpenWishAttachment(val bytes: ByteArray, val contentType: String = "image/jpeg")
public typealias IssueContextProvider = suspend () -> JsonObject
public typealias CardSearchProvider = suspend (query: String) -> List<OpenWishCard>

/**
 * @property cardSearchProvider searches the app's card database for card-data reports. When it
 * is null (the default) the issue dialog hides the "App bug / Card or detection" switch and every
 * report is filed as [IssueKind.BUG].
 */
public data class OpenWishConfiguration(
    val apiKey: String,
    val apiUrl: String = "https://wishkit.juli.sh/api",
    val apiVersion: OpenWishApiVersion = OpenWishApiVersion.AUTOMATIC,
    val issueContextProvider: IssueContextProvider = { JsonObject(emptyMap()) },
    val cardSearchProvider: CardSearchProvider? = null,
    val httpClient: OkHttpClient = OkHttpClient(),
)

@Serializable public data class OpenWishUser(val uuid: String)
@Serializable public data class OpenWishComment(
    val id: String, val userId: String, val description: String,
    val createdAt: String, val isAdmin: Boolean = false,
)
@Serializable public data class OpenWishFeature(
    val id: String, val userUUID: String, val title: String, val description: String,
    val state: String, val votingUsers: List<OpenWishUser> = emptyList(),
    val commentList: List<OpenWishComment> = emptyList(),
)
@Serializable public data class OpenWishFeatureList(
    val list: List<OpenWishFeature>, val shouldShowWatermark: Boolean = false,
)

/** An issue the current user filed ("My reports"). */
@Serializable public data class OpenWishIssue(
    val id: String, val userUUID: String, val title: String, val description: String,
    val state: String, val screenshotKeys: List<String> = emptyList(),
    val reporterEmail: String? = null, val kind: IssueKind = IssueKind.BUG,
    val context: JsonObject = JsonObject(emptyMap()), val card: OpenWishCard? = null,
    val commentList: List<OpenWishComment> = emptyList(),
    val createdAt: String, val updatedAt: String,
)
@Serializable public data class OpenWishIssueList(val list: List<OpenWishIssue>)

internal fun OpenWishFeatureList.visibleTo(userUuid: String): OpenWishFeatureList =
    copy(list = list.filter { feature ->
        feature.state != "pending" || feature.userUUID == userUuid
    })

/** Number of replies from the project's admins, shown as the "Admin replied" badge. */
internal fun adminReplyCount(comments: List<OpenWishComment>): Int = comments.count { it.isAdmin }

/** Newest report first; ISO-8601 timestamps that fail to parse sort by their text. */
internal fun List<OpenWishIssue>.newestFirst(): List<OpenWishIssue> =
    sortedWith(compareByDescending<OpenWishIssue> {
        runCatching { java.time.Instant.parse(it.createdAt) }.getOrNull()
    }.thenByDescending { it.createdAt })

/** Why an SDK call failed, so the UI can show a localized message. */
internal enum class OpenWishErrorKind { INVALID_EMAIL, INVALID_INPUT, IMAGE_LOAD, IMAGE_TOO_LARGE, UPLOAD, REQUEST }

internal class OpenWishException(
    val kind: OpenWishErrorKind,
    message: String,
    cause: Throwable? = null,
) : IOException(message, cause)

internal fun Throwable.openWishErrorKind(): OpenWishErrorKind =
    (this as? OpenWishException)?.kind ?: OpenWishErrorKind.REQUEST

@Serializable private data class CreateFeatureRequest(
    val title: String, val description: String, val email: String? = null,
    val state: String = "pending",
)
@Serializable private data class VoteRequest(val wishId: String)
@Serializable private data class CreateCommentRequest(val wishId: String, val description: String)
@Serializable private data class CreateIssueRequest(
    val title: String, val description: String, val email: String? = null,
    val screenshotKeys: List<String> = emptyList(), val kind: IssueKind,
    val context: JsonObject, val card: OpenWishCard? = null,
)
@Serializable private data class AttachmentResponse(val key: String)

/** Configure once from Application.onCreate, then present the supplied Compose surfaces. */
public object OpenWish {
    internal val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
        coerceInputValues = true
    }
    @Volatile private var client: OpenWishClient? = null

    public fun configure(context: Context, configuration: OpenWishConfiguration) {
        client = OpenWishClient(context.applicationContext, configuration, json)
    }

    internal fun requireClient(): OpenWishClient =
        checkNotNull(client) { "OpenWish.configure must be called before presenting OpenWish UI." }
}

internal class OpenWishClient(
    private val context: Context,
    internal val configuration: OpenWishConfiguration,
    private val json: Json,
) {
    private val apiUrl = configuration.apiUrl.trimEnd('/')
    internal val userUuid: String by lazy {
        val prefs = context.getSharedPreferences("openwish-sdk", Context.MODE_PRIVATE)
        prefs.getString("user-uuid", null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString("user-uuid", it).apply()
        }
    }

    suspend fun features(): OpenWishFeatureList = withContext(Dispatchers.IO) {
        val response: OpenWishFeatureList = when (configuration.apiVersion) {
            OpenWishApiVersion.V1 -> get("/wish/list")
            OpenWishApiVersion.V2 -> get("/v2/features")
            OpenWishApiVersion.AUTOMATIC -> runCatching { get<OpenWishFeatureList>("/v2/features") }
                .getOrElse { get("/wish/list") }
        }
        response.visibleTo(userUuid)
    }

    /** Issues filed by this installation's anonymous user, newest first. */
    suspend fun issues(): List<OpenWishIssue> = withContext(Dispatchers.IO) {
        val response: OpenWishIssueList = when (configuration.apiVersion) {
            OpenWishApiVersion.V1 -> get("/bug/list")
            OpenWishApiVersion.V2 -> get("/v2/issues")
            OpenWishApiVersion.AUTOMATIC -> runCatching { get<OpenWishIssueList>("/v2/issues") }
                .getOrElse { get("/bug/list") }
        }
        response.list.newestFirst()
    }

    suspend fun createFeature(title: String, description: String, email: String?) = withContext(Dispatchers.IO) {
        val cleanEmail = validatedEmail(email)
        post<JsonElement, _>("/wish/create", CreateFeatureRequest(title.trim(), description.trim(), cleanEmail))
    }

    suspend fun vote(featureId: String) = withContext(Dispatchers.IO) {
        post<JsonElement, _>("/wish/vote", VoteRequest(featureId))
    }

    suspend fun comment(featureId: String, text: String) = withContext(Dispatchers.IO) {
        val clean = text.trim()
        if (clean.length !in 1..2_000) {
            throw OpenWishException(OpenWishErrorKind.INVALID_INPUT, "A comment must contain 1–2000 characters.")
        }
        post<JsonElement, _>("/comment/create", CreateCommentRequest(featureId, clean))
    }

    suspend fun createIssue(
        title: String, description: String, email: String?, kind: IssueKind,
        card: OpenWishCard?, attachments: List<OpenWishAttachment>,
    ) = withContext(Dispatchers.IO) {
        val cleanTitle = title.trim()
        val cleanDescription = description.trim()
        if (cleanTitle.length !in 1..80) {
            throw OpenWishException(OpenWishErrorKind.INVALID_INPUT, "Issue title must contain 1–80 characters.")
        }
        if (cleanDescription.length !in 1..2_000) {
            throw OpenWishException(OpenWishErrorKind.INVALID_INPUT, "Issue description must contain 1–2000 characters.")
        }
        val cleanEmail = validatedEmail(email)
        val suppliedContext = configuration.issueContextProvider()
        val automaticContext = automaticIssueContext(OpenWishEnvironment.current(context))
        // Cards only belong to card-data reports, and only when the app can search cards.
        val effectiveKind = if (configuration.cardSearchProvider == null) IssueKind.BUG else kind
        val payload = CreateIssueRequest(
            cleanTitle, cleanDescription, cleanEmail,
            attachments.take(MAX_ATTACHMENTS).map(::uploadAttachment), effectiveKind,
            JsonObject(automaticContext + suppliedContext),
            card?.takeIf { effectiveKind == IssueKind.CARD_DATA }?.sanitizedForUpload(),
        )
        when (configuration.apiVersion) {
            OpenWishApiVersion.V1 -> post<JsonElement, _>("/bug/create", payload)
            OpenWishApiVersion.V2 -> post<JsonElement, _>("/v2/issues", payload)
            OpenWishApiVersion.AUTOMATIC -> runCatching { post<JsonElement, _>("/v2/issues", payload) }
                .getOrElse { post("/bug/create", payload) }
        }
    }

    private fun validatedEmail(email: String?): String? {
        val clean = email?.trim()?.ifBlank { null } ?: return null
        if (!android.util.Patterns.EMAIL_ADDRESS.matcher(clean).matches()) {
            throw OpenWishException(
                OpenWishErrorKind.INVALID_EMAIL,
                "Please enter a valid email address or leave the email field empty.",
            )
        }
        return clean
    }

    private fun OpenWishCard.sanitizedForUpload(): OpenWishCard {
        val cleanId = id.trim().take(200)
        val cleanName = name.trim().take(300)
        if (cleanId.isEmpty() || cleanName.isEmpty()) {
            throw OpenWishException(OpenWishErrorKind.INVALID_INPUT, "The selected card is missing its ID or name.")
        }
        val cleanImageUrl = imageUrl?.trim()?.takeIf { candidate ->
            candidate.toHttpUrlOrNull()?.scheme in setOf("http", "https")
        }
        return copy(
            id = cleanId,
            name = cleanName,
            setName = setName?.trim()?.take(300)?.ifBlank { null },
            number = number?.trim()?.take(100)?.ifBlank { null },
            imageUrl = cleanImageUrl,
        )
    }

    suspend fun searchCards(query: String): List<OpenWishCard> =
        configuration.cardSearchProvider?.invoke(query).orEmpty()

    private fun uploadAttachment(attachment: OpenWishAttachment): String {
        val normalized = attachment.normalizedForUpload()
        val preferred = if (configuration.apiVersion == OpenWishApiVersion.V1) "/bug/screenshot" else "/v2/attachments"
        return runCatching { upload(preferred, normalized) }.recoverCatching { error ->
            if (configuration.apiVersion == OpenWishApiVersion.AUTOMATIC) upload("/bug/screenshot", normalized)
            else throw error
        }.getOrElse { error ->
            throw OpenWishException(OpenWishErrorKind.UPLOAD, "Could not upload the image: ${error.message}", error)
        }
    }

    private fun upload(path: String, attachment: OpenWishAttachment): String {
        val req = request(path).post(attachment.bytes.toRequestBody(attachment.contentType.toMediaType()))
            .header("Accept", "application/json").build()
        return execute(req) { json.decodeFromString<AttachmentResponse>(it).key }
    }

    private fun OpenWishAttachment.normalizedForUpload(): OpenWishAttachment {
        if (bytes.isEmpty()) throw OpenWishException(OpenWishErrorKind.IMAGE_LOAD, "The selected image is empty.")
        val canonicalType = contentType.substringBefore(';').trim().lowercase().let {
            when (it) {
                "image/jpg", "image/pjpeg" -> "image/jpeg"
                "image/x-png" -> "image/png"
                else -> it
            }
        }
        val accepted = canonicalType in setOf("image/jpeg", "image/png", "image/heic", "image/webp")
        if (accepted && bytes.size <= MAX_ATTACHMENT_BYTES) {
            return OpenWishAttachment(bytes, canonicalType)
        }

        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            ?: throw OpenWishException(
                OpenWishErrorKind.IMAGE_LOAD,
                "Android could not decode this image. Please choose a JPEG, PNG, HEIC, or WebP image.",
            )
        val longestEdge = maxOf(decoded.width, decoded.height)
        val scaled = if (longestEdge > MAX_ATTACHMENT_EDGE) {
            val scale = MAX_ATTACHMENT_EDGE.toDouble() / longestEdge.toDouble()
            Bitmap.createScaledBitmap(
                decoded,
                (decoded.width * scale).roundToInt().coerceAtLeast(1),
                (decoded.height * scale).roundToInt().coerceAtLeast(1),
                true,
            )
        } else decoded

        var quality = 90
        var encoded: ByteArray
        do {
            val output = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, quality, output)
            encoded = output.toByteArray()
            quality -= 10
        } while (encoded.size > MAX_ATTACHMENT_BYTES && quality >= 40)
        if (scaled !== decoded) scaled.recycle()
        decoded.recycle()
        if (encoded.isEmpty() || encoded.size > MAX_ATTACHMENT_BYTES) {
            throw OpenWishException(
                OpenWishErrorKind.IMAGE_TOO_LARGE,
                "The selected image is too large to upload. Please choose a smaller image.",
            )
        }
        return OpenWishAttachment(encoded, "image/jpeg")
    }

    internal companion object {
        const val MAX_ATTACHMENTS = 4
        const val MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
        const val MAX_ATTACHMENT_EDGE = 2_048
    }

    private inline fun <reified T> get(path: String): T =
        execute(request(path).get().build()) { json.decodeFromString(it) }

    private inline fun <reified T, reified B> post(path: String, body: B): T {
        val encoded = json.encodeToString(body)
        val req = request(path).post(encoded.toRequestBody("application/json".toMediaType()))
            .header("Accept", "application/json").build()
        return execute(req) { json.decodeFromString(it) }
    }

    private fun request(path: String): Request.Builder = Request.Builder().url("$apiUrl$path")
        .header("x-wishkit-api-key", configuration.apiKey)
        .header("x-wishkit-uuid", userUuid)
        .header("x-wishkit-sdk-app-name", context.applicationInfo.loadLabel(context.packageManager).toString())
        .header("x-wishkit-sdk-kind", "android")
        .header("x-wishkit-sdk-version", OpenWishSdk.VERSION)
        .header("x-openwish-device", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")

    private fun <T> execute(request: Request, decode: (String) -> T): T {
        configuration.httpClient.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IOException("OpenWish ${response.code}: $body")
            return decode(body)
        }
    }
}
