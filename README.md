# OpenWish

OpenWish is a **self-hosted Cloudflare backend, admin dashboard, and Swift SDK fork of [WishKit](https://github.com/wishkit/wishkit-ios)** — the SwiftUI feedback library by [Martin Lasek](https://github.com/martinlasek). It replaces the hosted `wishkit.io` service with a stack you run yourself on Cloudflare's free / pay-as-you-go tier, and adds a handful of features the hosted product doesn't have (bug reports with screenshots, passkey login, email notifications, rate limiting, multi-device passkeys, and more).

> WishKit is © 2023 Martin Lasek, MIT licensed. OpenWish forks the Swift package under the same license, renames the public API surface from `WishKit.*` to `OpenWish.*`, and pairs it with a Cloudflare Worker backend. The original WishKit project lives at https://github.com/wishkit/wishkit-ios — please star/sponsor it.

## What OpenWish adds on top of WishKit

| Feature | Hosted WishKit (wishkit.io) | OpenWish |
| --- | --- | --- |
| Backend you control | ❌ | ✅ Cloudflare Workers + D1 |
| Wishes (feature requests) | ✅ | ✅ — same Swift SDK contract |
| Bug + card-data reports with screenshots | ❌ | ✅ R2-backed, up to 4 per issue |
| User-visible "my bug reports" with admin replies | ❌ | ✅ |
| Email notifications on new wishes / bugs / user comments | ❌ | ✅ via Cloudflare Email Routing |
| Per-project notification email + send-test from the dashboard | ❌ | ✅ |
| Single-user dashboard auth | password only | password **+ passkeys** (WebAuthn, multi-device) |
| Rate limiting per device + per project | ❌ | ✅ Workers KV–backed fixed windows |
| Project switcher / multiple projects per dashboard | per account | ✅ unlimited |
| Custom domain | ❌ | ✅ Cloudflare custom domain on the Worker |

The Swift SDK contract (`/api/wish/list`, `/api/wish/create`, `/api/wish/vote`, `/api/comment/create`, `/api/user/update`) is preserved byte-for-byte, so existing WishKit-using apps can migrate by swapping `import WishKit` → `import OpenWish` and pointing `OpenWish.configure(apiUrl:)` at their own host.

## Repo layout

- `Sources/OpenWish` — the OpenWish Swift package (forked from Martin Lasek's WishKit, renamed). New on top of upstream: the `apiUrl` parameter on `OpenWish.configure`, and `OpenWish.BugReportView()` for the bug-report flow.
- `apps/web` — the OpenWish server. TanStack Start app deployed as a single Cloudflare Worker. **Read [`apps/web/README.md`](apps/web/README.md) for hosting & operations.**
- `packages/shared` — TypeScript request/response schemas (zod) shared between the Worker and the dashboard SPA.
- `ExampleApp/openwish` — Xcode project showing how to wire `OpenWish` into an iOS app.

## Swift Package Manager

```swift
.package(url: "https://github.com/julianfbeck/OpenWish.git", from: "1.0.0")
// then depend on the `OpenWish` product:
.product(name: "OpenWish", package: "openwish")
```

Then in code:

```swift
import OpenWish

OpenWish.configure(
    with: "ow_api_<your-key>",
    apiUrl: "https://wishkit.example.com/api",
    apiVersion: .automatic
)
```

Resolution order for the API URL:
1. `apiUrl` passed to `OpenWish.configure(...)`
2. `wishkit-url` process environment variable (kept for upstream compatibility)
3. fallback `https://www.wishkit.io/api` (i.e. the original WishKit hosted endpoint)

`OpenWish.FeedbackListView()` and `OpenWish.BugReportView()` are the two public SwiftUI surfaces. Both work as `.sheet` content inside a `NavigationStack`.

### V2 diagnostics and card data

`.automatic` tries `/api/v2` and falls back to the original WishKit-compatible
routes when an older deployment does not have V2 yet. Use `.v1` to pin an app
to the legacy contract or `.v2` to require V2.

Apps can attach arbitrary structured diagnostics without coupling OpenWish to
RevenueCat or a particular analytics/database SDK:

```swift
OpenWish.configure(
    with: "ow_api_<your-key>",
    apiUrl: "https://wishkit.example.com/api",
    issueContextProvider: {
        [
            "revenueCat": .object([
                "appUserId": .string(Purchases.shared.appUserID),
                "isPro": .bool(isPro)
            ]),
            "metrics": .object([
                "cardsScanned": .number(Double(cardsScanned))
            ])
        ]
    },
    cardSearchProvider: { query in
        await cardDatabase.search(query).map {
            OpenWishCard(id: $0.id, name: $0.name, setName: $0.setName, number: $0.number)
        }
    }
)
```

OpenWish adds SDK/app/OS/locale fields automatically. The provider is evaluated
only when the user submits a report. Do not attach secrets or data your privacy
policy does not permit you to collect.

### Agent access

The Worker implements a stateless Streamable HTTP MCP server at
`https://<your-host>/mcp` with two authentication options:

- **OAuth for ChatGPT:** add `https://wishkit.juli.sh/mcp` (or your own host)
  as the MCP URL and select OAuth. Sign in with your existing OpenWish dashboard
  login/passkey, choose existing projects and approve permissions. Reading is
  the default; editing and destructive actions require additional permissions.
  Clients such as Cursor request only read access, so the consent page always
  offers write and admin as unchecked extras that only you can grant.
  Access tokens expire after 15 minutes. The separate, unchecked **Keep this
  connection until I revoke it** option permits renewable access without a fixed
  grant expiry. It does not add editing permissions. Existing finite grants keep
  their original expiry; persistent access requires fresh consent.
  Manage or revoke connections at **Projects → Agent access (MCP) → Manage OAuth
  access**. Automatic client registration handles OAuth client setup. Refresh
  tokens rotate after each use; reusing a consumed token revokes the connection
  and requires reconnecting.
- **Global API key for trusted clients:** send
  `Authorization: Bearer <OPENWISH_GLOBAL_API_KEY>`. This retains full access to
  all projects and all 20 tools, including project creation. The dashboard shows
  the MCP URL and masked/revealable key under **Projects → Agent access (MCP)**.

The tools cover project settings and analytics, feature and issue management,
state transitions, reporter replies, merges, private notes, screenshots, and
test email. OAuth grants apply to selected immutable project IDs; they cannot
create new projects. Replies and resolution changes can email reporters.

For a read-only ChatGPT connection, use `mcp:read offline_access` if its OAuth
settings offer **Base scopes**, then explicitly approve the connection lifetime
in OpenWish. The lifetime checkbox can also permit refresh tokens when ChatGPT
requests only `mcp:read`; automatic refresh in that case still needs an approved
live expiry test. A grant without a fixed expiry does not guarantee uninterrupted
access: client credentials, metadata availability, host policies, and token
replay can still require reconnecting. See the [OAuth lifecycle and client
limits](apps/web/README.md#oauth-access-for-chatgpt).

Example configuration for a client using the global key:

```json
{
  "mcpServers": {
    "openwish": {
      "url": "https://wishkit.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <copy from OpenWish settings>"
      }
    }
  }
}
```

[`apps/mcp`](apps/mcp) remains available as a compatibility stdio bridge for
clients that cannot connect to remote MCP servers.

OAuth requires deployment of this version with its `MCP_OAUTH_STATE` SQLite
Durable Object binding/migration and configured public origin. Adding the source
does not enable OAuth on an existing deployment. Merge the OAuth settings from
`apps/web/wrangler.example.jsonc` into your existing `wrangler.jsonc`, preserving
your production resource IDs, domains, and prior migrations. See the
[OAuth hosting prerequisites](apps/web/README.md#oauth-hosting-prerequisites)
and [OpenAI's authentication guide](https://developers.openai.com/plugins/build/auth).

## Hosting OpenWish

See **[`apps/web/README.md`](apps/web/README.md)** for the step-by-step Cloudflare setup. Short version:

1. A Cloudflare account.
2. The `wrangler` CLI logged in (`wrangler login`).
3. A D1 database, an R2 bucket, a KV namespace, and Email Routing on a domain you control.
4. `pnpm install && pnpm --filter @openwish/web run deploy`.

## Local development

```bash
pnpm install
cp apps/web/.dev.vars.example apps/web/.dev.vars
# edit apps/web/.dev.vars to provide username/password/session-secret
pnpm dev
```

The dashboard and `/api/**` routes are served from the same TanStack Start app on `http://localhost:5173`.

## Verification

```bash
swift test          # OpenWish Swift package tests
pnpm typecheck      # TS for shared package + web app
pnpm test           # vitest (45+ cases covering SDK + admin + passkey + rate-limit flows)
pnpm build          # vite build (regenerates the route tree)
```

## Credits & license

- **WishKit** (the upstream Swift library this fork is based on) — © 2023 Martin Lasek, [MIT-licensed](https://github.com/wishkit/wishkit-ios/blob/main/LICENSE). Source: https://github.com/wishkit/wishkit-ios. None of this exists without it — please star or sponsor the upstream project.
- **`wishkit-ios-shared`** — Martin Lasek's shared types package, [MIT-licensed](https://github.com/wishkit/wishkit-ios-shared/blob/main/LICENSE). OpenWish depends on `1.5.0` unmodified for `WishResponse`, `CommentResponse`, etc.
- **OpenWish** (this fork — server, dashboard, renamed Swift API surface, bug-report extensions) — same MIT license; see `LICENSE`.
