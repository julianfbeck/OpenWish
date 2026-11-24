# Releasing OpenWish

OpenWish has three deliverables in one repository:

| Part | Where | Released how |
|---|---|---|
| Swift package `OpenWish` | `Package.swift`, `Sources/OpenWish` | git tag `vX.Y.Z`, resolved by Swift Package Manager |
| Android library | `android/openwish` | the same git tag, built by JitPack as `com.github.julianfbeck:OpenWish:vX.Y.Z` |
| Backend + dashboard + MCP | `apps/web` (Cloudflare Worker, D1, R2, KV) | `pnpm run deploy` from `main`, not tied to a tag |

`apps/api` is not part of the product; it only holds untracked local Wrangler
state. `apps/cli` and `apps/mcp` are Go tools built from source.

## Version numbers

- One number for Swift and Android. A tag releases both, even when only one
  changed.
- Semantic versioning: patch = fixes, minor = additions (new API, new context
  fields, new screens), major = a breaking change to the public Swift/Kotlin API
  or to a request the backend must still accept.
- The number lives in these places; change them in the same commit:
  - `Sources/OpenWish/ProjectSettings.swift` → `sdkVersion` (sent as
    `x-wishkit-sdk-version` and `context.sdk.version`)
  - `android/openwish/src/main/java/com/openwish/android/OpenWish.kt` →
    `OpenWishSdk.VERSION` (and the local fallback `openwishVersion` in
    `android/gradle.properties`; JitPack uses the tag)
  - `CHANGELOG.md` → a new `## [X.Y.Z]` section
- Apps depend on version ranges, never on revisions:
  - Xcode / SwiftPM: "Up to Next Minor Version" from `X.Y.0`
    (`.upToNextMinor(from: "1.2.0")`), so patch releases arrive without an edit
    and minor releases are a deliberate bump.
  - Gradle: `implementation("com.github.julianfbeck:OpenWish:vX.Y.Z")` (JitPack
    has no ranges; bump the tag in each app).

## Compatibility rules

Shipped apps cannot be updated in place, so the backend must keep accepting
every request any released SDK sends and keep every response shape they decode.

- `apps/web/test/sdk-contract.test.ts` pins the SDK response shapes. It must
  stay green. Dashboard/MCP-only fields (`platform`, `githubLinks`, AI triage
  notes …) never appear in SDK responses.
- New data goes into `context` (free-form JSON, dashboard-only) or into new
  `/api/v2/...` routes.
- Deploy the backend before any app that needs it. A new SDK must still work
  against the previous backend (V2 → V1 fallback, unknown header values are
  ignored).

## Release checklist

1. **Check production first** (from `apps/web`, read-only):
   ```bash
   pnpm exec wrangler deployments list
   pnpm exec wrangler d1 migrations list openwish --remote
   ```
   Know which commit is live and which migrations are applied.
2. **Tests** (CI runs the same on every PR, `.github/workflows/ci.yml`):
   ```bash
   swift test
   pnpm install --frozen-lockfile && pnpm typecheck && pnpm test
   (cd apps/cli && go build ./...) && (cd apps/mcp && go build ./...)
   python3 scripts/generate-localizations.py --check
   (cd android && ./gradlew :openwish:testDebugUnitTest :openwish:assembleRelease)
   ```
3. **Bump** the version in the three places above, write the changelog section
   (what changed per part, which migrations/bindings the backend needs, what
   apps must do). Merge to `main` with a merge commit (the tag must point at a
   commit on `main`).
4. **Backend, if it changed** (from `apps/web`, in this order):
   ```bash
   pnpm exec wrangler d1 migrations apply openwish --remote   # new migrations only
   pnpm run deploy                                            # vite build + wrangler deploy
   ```
   Then smoke-test: `curl -s https://wishkit.juli.sh/health`, open the
   dashboard, list issues through MCP. New bindings or vars go into the
   gitignored `apps/web/wrangler.jsonc` before the deploy (see
   `wrangler.example.jsonc`).
5. **Tag** the merge commit and push the tag:
   ```bash
   git tag -a vX.Y.Z -m "OpenWish X.Y.Z" <commit-on-main>
   git push origin vX.Y.Z
   gh release create vX.Y.Z --notes-file <(sed -n '/## \[X.Y.Z\]/,/## \[/p' CHANGELOG.md | sed '$d')
   ```
6. **JitPack**: open `https://jitpack.io/#julianfbeck/OpenWish/vX.Y.Z` (or
   request `https://jitpack.io/com/github/julianfbeck/OpenWish/vX.Y.Z/OpenWish-vX.Y.Z.pom`)
   to trigger the build and read its log. The build runs `jitpack.yml`.
7. **Apps**: bump each app's dependency (Xcode package requirement / Gradle
   coordinate), build, send one test report from a debug build and check it in
   the dashboard (platform tag, context, screenshots), then ship the app as
   usual.

## Localization

SDK strings live in `localization/strings.json` (22 languages, the union of the
apps' languages). `python3 scripts/generate-localizations.py` writes
`Sources/OpenWish/Resources/Localizable.xcstrings` and the Android
`openwish_strings.xml` files; never edit those by hand. CI fails when they are
out of date.
