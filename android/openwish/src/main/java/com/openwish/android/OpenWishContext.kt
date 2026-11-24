package com.openwish.android

import android.content.Context
import android.os.Build
import android.os.LocaleList
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Locale
import java.util.TimeZone

/** The values the SDK reports with every issue; read from Android by [current]. */
internal data class OpenWishEnvironment(
    val packageName: String,
    val appVersion: String,
    val versionCode: Long,
    val manufacturer: String,
    val model: String,
    val androidVersion: String,
    val apiLevel: Int,
    val locale: String,
    val preferredLanguages: List<String>,
    val timeZone: String,
) {
    companion object {
        fun current(context: Context): OpenWishEnvironment {
            val packageInfo = runCatching { context.packageManager.getPackageInfo(context.packageName, 0) }.getOrNull()
            val locales = LocaleList.getDefault()
            return OpenWishEnvironment(
                packageName = context.packageName,
                appVersion = packageInfo?.versionName ?: "unknown",
                versionCode = packageInfo?.longVersionCode ?: 0L,
                manufacturer = Build.MANUFACTURER,
                model = Build.MODEL,
                androidVersion = Build.VERSION.RELEASE,
                apiLevel = Build.VERSION.SDK_INT,
                locale = Locale.getDefault().toLanguageTag(),
                preferredLanguages = (0 until locales.size()).map { locales[it].toLanguageTag() },
                timeZone = TimeZone.getDefault().id,
            )
        }
    }
}

/** The automatic `context` of a report: `app`, `device` and `sdk` objects. */
internal fun automaticIssueContext(environment: OpenWishEnvironment): JsonObject = JsonObject(mapOf(
    "app" to JsonObject(mapOf(
        "package" to JsonPrimitive(environment.packageName),
        "version" to JsonPrimitive(environment.appVersion),
        "versionCode" to JsonPrimitive(environment.versionCode),
    )),
    "device" to JsonObject(mapOf(
        "platform" to JsonPrimitive("android"),
        "manufacturer" to JsonPrimitive(environment.manufacturer),
        "model" to JsonPrimitive(environment.model),
        "androidVersion" to JsonPrimitive(environment.androidVersion),
        "apiLevel" to JsonPrimitive(environment.apiLevel),
        "locale" to JsonPrimitive(environment.locale),
        "preferredLanguages" to JsonArray(environment.preferredLanguages.map(::JsonPrimitive)),
        "timeZone" to JsonPrimitive(environment.timeZone),
    )),
    "sdk" to JsonObject(mapOf(
        "name" to JsonPrimitive(OpenWishSdk.NAME),
        "version" to JsonPrimitive(OpenWishSdk.VERSION),
    )),
))
