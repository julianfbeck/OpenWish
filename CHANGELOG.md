# Changelog

One version number covers the Swift package and the Android library. Tags are
`vMAJOR.MINOR.PATCH`; Swift Package Manager resolves them as `MAJOR.MINOR.PATCH`
and JitPack publishes them as `com.github.julianfbeck:OpenWish:vMAJOR.MINOR.PATCH`.
The Cloudflare backend (`apps/web`) deploys from `main` and is not versioned by
tag, but every SDK release lists the backend it needs.

How to cut a release: [`RELEASING.md`](RELEASING.md).

## [Unreleased]

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
