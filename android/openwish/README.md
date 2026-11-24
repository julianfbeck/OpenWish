# OpenWish Android

Kotlin and Jetpack Compose client for OpenWish: feature requests with votes and
comments, bug and card-data reports with screenshots, and "My reports" with the
replies from your team. It sends the WishKit request headers, uses the V2 feature,
issue and attachment endpoints, and falls back to the WishKit routes when the
server has no V2 API.

This directory is the only source of the Android SDK. Apps depend on the
published artifact and do not keep a copy.

## Versions

The SDK version is the OpenWish repository tag, the same tag as the Swift package
(`v1.2.0` ships Swift `1.2.0` and Android `v1.2.0`). The version is in
`OpenWishSdk.VERSION`; the SDK sends it in the `x-wishkit-sdk-version` header and
in `context.sdk.version` of every report. Release notes: [`CHANGELOG.md`](../../CHANGELOG.md).

## Install (JitPack)

`settings.gradle.kts`:

```kotlin
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        maven("https://jitpack.io") {
            content { includeGroup("com.github.julianfbeck") }
        }
    }
}
```

Module `build.gradle.kts`:

```kotlin
dependencies {
    implementation("com.github.julianfbeck:OpenWish:v1.2.0")
}
```

Requirements: minSdk 29, Jetpack Compose (Material 3). The library brings
OkHttp and kotlinx.serialization (both are part of its API).

## Configure

Call `configure` once from `Application.onCreate`:

```kotlin
OpenWish.configure(
    application,
    OpenWishConfiguration(
        apiKey = "your-project-key",
        apiUrl = "https://your-openwish-host/api",          // default: https://wishkit.juli.sh/api
        apiVersion = OpenWishApiVersion.AUTOMATIC,           // V2 first, WishKit routes as fallback
        issueContextProvider = { buildJsonObject { put("accountId", accountId) } },
        // Optional. Only for apps with a card database:
        cardSearchProvider = { query -> cardRepository.search(query).map(::toOpenWishCard) },
    ),
)
```

Then present the dialogs from any Compose screen:

```kotlin
if (showFeatures) OpenWishFeatureDialog(onDismiss = { showFeatures = false })
if (showReport) OpenWishIssueDialog(onDismiss = { showReport = false })
if (showMyReports) OpenWishReportsDialog(onDismiss = { showMyReports = false })
```

### Card reports

`cardSearchProvider` is optional and `null` by default. Without it, the issue
dialog hides the "App bug / Card or detection" switch and every report is filed as
`IssueKind.BUG`. With it, users can switch to a card report and search for the
affected card. Picking a card is optional (as on iOS): a user who cannot find the
card can describe it and attach a photo.

### Report context

Every report carries an automatic `context`, merged with the JSON your
`issueContextProvider` returns (your top-level keys win):

| Key | Fields |
|---|---|
| `app` | `package`, `version`, `versionCode` |
| `device` | `platform` (`"android"`), `manufacturer`, `model`, `androidVersion`, `apiLevel`, `locale`, `preferredLanguages` (the system language list), `timeZone` |
| `sdk` | `name` (`"openwish-android"`), `version` |

The user is an anonymous UUID stored in the app's private preferences.

## Screens

- **Feature requests** (`OpenWishFeatureDialog`): the board by state, voting,
  new requests with an optional email, and a detail page per request with its
  description and comments, where users can post a comment
  (`POST /comment/create`).
- **Report a problem** (`OpenWishIssueDialog`): title, description, optional
  email, up to four screenshots (camera or photo picker), card search when a
  provider is configured, and a "My reports" button.
- **My reports** (`OpenWishReportsDialog`): the user's reports, newest first,
  with their state, an "Admin replied" badge and the conversation
  (`GET /v2/issues`, falling back to `/bug/list`).

## Localization

The UI strings are resources named `openwish_*`, generated in 22 languages from
`localization/strings.json` in the repository root by
`python3 scripts/generate-localizations.py`. Do not edit the generated
`openwish_strings.xml` files; change `strings.json` and run the script.

An app can replace any text by defining a string with the same name in its own
module, for example in `app/src/main/res/values/strings.xml`:

```xml
<string name="openwish_bug_navReportProblem">Send feedback</string>
```

App resources take precedence over library resources at build time.

## Build and test

```sh
cd android
./gradlew :openwish:testDebugUnitTest :openwish:assembleRelease
./gradlew :openwish:publishToMavenLocal   # what JitPack runs (see jitpack.yml)
```

Local builds need `android/local.properties` with `sdk.dir=…` (gitignored) and
JDK 17 or newer.
