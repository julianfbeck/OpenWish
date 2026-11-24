package com.openwish.android

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OpenWishModelsTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    @Test
    fun v2FeatureListAcceptsAdditionalServerFields() {
        val response = json.decodeFromString<OpenWishFeatureList>(
            """{"list":[{"id":"feature-id","userUUID":"user-id","title":"Scanner","description":"Improve detection","state":"inProgress","votingUsers":[],"commentList":[],"futureField":true}],"shouldShowWatermark":false}""",
        )
        assertEquals("Scanner", response.list.single().title)
        assertEquals("inProgress", response.list.single().state)
    }

    @Test
    fun pendingFeaturesAreOnlyVisibleToTheirCreator() {
        val response = OpenWishFeatureList(
            list = listOf(
                OpenWishFeature("private", "owner", "Private", "Pending", "pending"),
                OpenWishFeature("public", "owner", "Public", "Planned", "planned"),
            ),
        )

        assertEquals(listOf("private", "public"), response.visibleTo("owner").list.map { it.id })
        assertEquals(listOf("public"), response.visibleTo("other").list.map { it.id })
    }

    @Test
    fun issueListDecodesUnknownFieldsAndMissingOptionalFields() {
        // A V2 issue with fields this SDK does not know, and a V1 /bug/list issue that has no
        // kind, context, card, reporterEmail or screenshotKeys and an unknown future kind.
        val response = OpenWish.json.decodeFromString<OpenWishIssueList>(
            """{"list":[
              {"id":"a","userUUID":"u","title":"Crash","description":"On launch","state":"open",
               "screenshotKeys":["k1"],"reporterEmail":"a@b.co","kind":"cardData",
               "context":{"app":{"version":"6.0"}},"card":{"id":"sv01-056","name":"Pikachu","rarity":"x"},
               "commentList":[{"id":"c1","userId":"admin","description":"Thanks","createdAt":"2026-11-20T10:00:00.000Z","isAdmin":true,"extra":1}],
               "createdAt":"2026-11-19T10:00:00.000Z","updatedAt":"2026-11-20T10:00:00.000Z","platform":"android","priority":2},
              {"id":"b","userUUID":"u","title":"Old","description":"V1","state":"fixed",
               "kind":"somethingNew","reporterEmail":null,
               "createdAt":"2026-11-01T10:00:00.000Z","updatedAt":"2026-11-02T10:00:00.000Z"}
            ],"futureTopLevel":true}""",
        )

        val (v2, v1) = response.list
        assertEquals(IssueKind.CARD_DATA, v2.kind)
        assertEquals("Pikachu", v2.card?.name)
        assertEquals(listOf("k1"), v2.screenshotKeys)
        assertEquals(1, v2.commentList.size)
        assertTrue(v2.commentList.single().isAdmin)

        assertEquals(IssueKind.BUG, v1.kind)
        assertNull(v1.card)
        assertNull(v1.reporterEmail)
        assertEquals(emptyList<String>(), v1.screenshotKeys)
        assertEquals(JsonObject(emptyMap()), v1.context)
        assertEquals(emptyList<OpenWishComment>(), v1.commentList)
    }

    @Test
    fun issuesAreSortedNewestFirst() {
        fun issue(id: String, createdAt: String) = OpenWishIssue(
            id = id, userUUID = "u", title = id, description = id, state = "open",
            createdAt = createdAt, updatedAt = createdAt,
        )
        val sorted = listOf(
            issue("old", "2026-01-01T00:00:00Z"),
            issue("new", "2026-11-24T08:00:00.000Z"),
            issue("mid", "2026-06-01T12:00:00+02:00"),
        ).newestFirst()

        assertEquals(listOf("new", "mid", "old"), sorted.map { it.id })
    }

    @Test
    fun automaticContextCarriesAppDeviceAndSdk() {
        val context = automaticIssueContext(
            OpenWishEnvironment(
                packageName = "com.example.app",
                appVersion = "2.2.0",
                versionCode = 42,
                manufacturer = "Google",
                model = "Pixel 9",
                androidVersion = "16",
                apiLevel = 36,
                locale = "de-DE",
                preferredLanguages = listOf("de-DE", "en-US"),
                timeZone = "Europe/Berlin",
            ),
        )

        assertEquals(setOf("app", "device", "sdk"), context.keys)
        val app = context.getValue("app").jsonObject
        assertEquals("com.example.app", app.getValue("package").jsonPrimitive.content)
        assertEquals("2.2.0", app.getValue("version").jsonPrimitive.content)
        assertEquals(JsonPrimitive(42L), app.getValue("versionCode"))

        val device = context.getValue("device").jsonObject
        assertEquals(
            setOf("platform", "manufacturer", "model", "androidVersion", "apiLevel", "locale", "preferredLanguages", "timeZone"),
            device.keys,
        )
        assertEquals("android", device.getValue("platform").jsonPrimitive.content)
        assertEquals("Pixel 9", device.getValue("model").jsonPrimitive.content)
        assertEquals("Google", device.getValue("manufacturer").jsonPrimitive.content)
        assertEquals("Europe/Berlin", device.getValue("timeZone").jsonPrimitive.content)
        val languages = device.getValue("preferredLanguages")
        assertTrue(languages is JsonArray)
        assertEquals(listOf("de-DE", "en-US"), languages.jsonArray.map { it.jsonPrimitive.content })

        val sdk = context.getValue("sdk").jsonObject
        assertEquals("openwish-android", sdk.getValue("name").jsonPrimitive.content)
        assertEquals(OpenWishSdk.VERSION, sdk.getValue("version").jsonPrimitive.content)
    }

    @Test
    fun issueKindSwitchOnlyShowsWithACardSearchProvider() {
        assertFalse(showsIssueKindSwitch(OpenWishConfiguration(apiKey = "key")))
        assertFalse(showsIssueKindSwitch(OpenWishConfiguration(apiKey = "key", cardSearchProvider = null)))
        assertTrue(showsIssueKindSwitch(OpenWishConfiguration(apiKey = "key", cardSearchProvider = { emptyList() })))
    }

    @Test
    fun adminRepliesAreCounted() {
        fun comment(id: String, isAdmin: Boolean) =
            OpenWishComment(id = id, userId = "x", description = id, createdAt = "2026-11-24T00:00:00Z", isAdmin = isAdmin)

        assertEquals(0, adminReplyCount(emptyList()))
        assertEquals(0, adminReplyCount(listOf(comment("mine", false))))
        assertEquals(2, adminReplyCount(listOf(comment("a", true), comment("mine", false), comment("b", true))))
    }
}
