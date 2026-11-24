# Changelog

One version number covers the Swift package and the Android library. Tags are
`vMAJOR.MINOR.PATCH`; Swift Package Manager resolves them as `MAJOR.MINOR.PATCH`
and JitPack publishes them as `com.github.julianfbeck:OpenWish:vMAJOR.MINOR.PATCH`.
The Cloudflare backend (`apps/web`) deploys from `main` and is not versioned by
tag, but every SDK release lists the backend it needs.

How to cut a release: [`RELEASING.md`](RELEASING.md).

## [Unreleased]

## [1.2.0]

Swift package and Android library, same version. Apps keep compiling without
changes; Android apps switch from their vendored `:openwish` module to JitPack.

### Both SDKs
- UI in 22 languages (the union of the apps' languages: ar, ca, de, en, es,
  fr, hi, id, it, ja, ko, nl, pl, pt-BR, pt-PT, ru, th, tr, vi, zh-Hans,
  zh-Hant, zu) from `localization/strings.json`.
- The "App bug / Card or detection" switch is hidden when the app configures
  no `cardSearchProvider`; reports are then plain bugs.
- More context per report: device model, platform, time zone and preferred
  languages (dashboard/MCP only).
- SDK version reported as `1.2.0` on both platforms (Android sent `2.0.0`).

### Swift
- Strings ship as `Localizable.xcstrings` in the package (`Bundle.module`) and
  follow the app's own language. Overrides: `OpenWish.config.localization`
  (unchanged) or an `OpenWish` string table in the app for any key.
- Mac apps (native, Catalyst, iPhone/iPad app on Mac) send the `macos` SDK kind
  and show as macOS in the dashboard.
- Debug logging through `os.Logger` (subsystem `OpenWish`) instead of `print`.
- swift-tools-version 5.9 (Xcode 15 or newer).

### Android
- Single source in this repository (`android/openwish`), published by JitPack
  as `com.github.julianfbeck:OpenWish:v1.2.0`; replaces the copies in the apps.
- `cardSearchProvider` is nullable (default `null`); picking a card is optional.
- My reports screen (`OpenWishReportsDialog`, and a button in the report
  dialog) with admin replies; feature detail with comments and a comment field.
- `kotlinx-serialization-json` and `okhttp` are `api` dependencies.

### Backend (`apps/web`), deploy before the apps
- `macos` platform (header or context), shown as macOS.
- AI triage of new issues on Workers AI: one private note per issue with an
  English translation, a one-line summary and likely duplicates. Never replies
  to users. Needs the `AI` binding; `OPENWISH_AI_TRIAGE=off` switches it off.
- Dashboard issue dialog shows private notes.
- MCP: filters, paging and compact rows for `openwish_list_issues`;
  `openwish_get_issue` / `openwish_get_feature` by short id;
  `openwish_find_similar_issues`; `openwish_get_reporter_history`;
  `openwish_issue_stats`; `openwish_triage_issue` (28 tools).
- Dependencies: MCP server 2.4, agents 0.34, OAuth provider 1.3, wrangler
  4.168, SimpleWebAuthn 14, pinned `@tanstack/*`.
- No new D1 migration. SDK response shapes unchanged
  (`test/sdk-contract.test.ts`).

## [1.1.0]

First release since the V2 work. Additions only; apps on 1.0.x can move up
without code changes.

### Swift SDK
- V2 client (`apiVersion: .automatic | .v1 | .v2`). `.automatic` tries
  `/api/v2` on a self-hosted URL and falls back to the WishKit-compatible
  routes.
- Issue kinds (`bug`, `cardData`), `issueContextProvider` for app diagnostics,
  `cardSearchProvider` for card-data reports.
- Reports include SDK, app (bundle id, version, build), OS and locale context.
- `ProjectSettings.sdkVersion` reports the OpenWish version (`1.1.0`) instead of
  upstream WishKit's `5.0.0`.

### Backend (`apps/web`)
- V2 routes: `/api/v2/features`, `/api/v2/issues`, `/api/v2/attachments`,
  private issue notes.
- Remote MCP server at `/mcp` (22 tools) with dashboard-authorized OAuth and
  until-revoked grants; global API key access for trusted clients.
- Global cross-project API (`/api/v1`) and the Go CLI (`apps/cli`).
- Owner emails on user comments, direct dashboard links per item, iOS/Android
  platform tags, GitHub issue/PR links on feedback.
- `test/sdk-contract.test.ts` pins the response shapes shipped apps decode.

Needs migrations up to `0010_platform_github_links.sql`.

## [1.0.1] - 2026-06-06
- Compress bug-report screenshots before upload.

## [1.0.0] - 2026-05-04
- WishKit fork renamed to `OpenWish`, `apiUrl` on `OpenWish.configure`,
  `OpenWish.BugReportView()` with screenshot uploads.
