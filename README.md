# OpenWish

OpenWish is a **self-hosted Cloudflare backend and admin dashboard for [WishKit](https://github.com/wishkit/wishkit-ios)**, the SwiftUI feedback library by [Martin Lasek](https://github.com/martinlasek). The original Swift package is included unchanged so existing WishKit clients keep working — OpenWish replaces the hosted `wishkit.io` API with a stack you run yourself on Cloudflare's free / pay-as-you-go tier and adds a few features the hosted product doesn't have.

> WishKit is © 2023 Martin Lasek, MIT licensed. OpenWish builds on it without forking the SwiftUI library — point `WishKit.configure(apiUrl:)` at your own deployment and everything else stays the same.

## What OpenWish adds on top of WishKit

| Feature | Hosted WishKit (wishkit.io) | OpenWish |
| --- | --- | --- |
| Backend you control | ❌ | ✅ Cloudflare Workers + D1 |
| Wishes (feature requests) | ✅ | ✅ — same Swift SDK contract |
| Bug reports with screenshots | ❌ | ✅ R2-backed, up to 4 per bug |
| User-visible "my bug reports" with admin replies | ❌ | ✅ |
| Email notifications on new wishes / bugs | ❌ | ✅ via Cloudflare Email Routing |
| Per-project notification email + send-test from the dashboard | ❌ | ✅ |
| Single-user dashboard auth | password only | password **+ passkeys** (WebAuthn, multi-device) |
| Rate limiting per device + per project | ❌ | ✅ Workers KV–backed fixed windows |
| Project switcher / multiple projects per dashboard | per account | ✅ unlimited |
| Custom domain | ❌ | ✅ Cloudflare custom domain on the Worker |

The Swift SDK contract (`/api/wish/list`, `/api/wish/create`, `/api/wish/vote`, `/api/comment/create`, `/api/user/update`) is preserved byte-for-byte, so existing WishKit-using apps only need to point `WishKit.configure(apiUrl:)` at the new host.

## Repo layout

- `Sources/WishKit` — the upstream WishKit Swift package (Martin Lasek's MIT-licensed library). The only modification is accepting `apiUrl` in `WishKit.configure` so the SDK can talk to a non-`wishkit.io` host. Net-new SwiftUI: `WishKit.BugReportView()` for the bug-report flow.
- `apps/web` — the OpenWish server. TanStack Start app deployed as a single Cloudflare Worker. **Read [`apps/web/README.md`](apps/web/README.md) for hosting & operations.**
- `packages/shared` — TypeScript request/response schemas (zod) shared between the Worker and the dashboard SPA.
- `ExampleApp/openwish` — Xcode project showing how to point WishKit at an OpenWish deployment.

## Swift compatibility

```swift
WishKit.configure(
    with: "ow_api_<your-key>",
    apiUrl: "https://wishkit.example.com/api"
)
```

Resolution order:
1. `apiUrl` passed to `WishKit.configure(...)`
2. `wishkit-url` process environment variable
3. fallback `https://www.wishkit.io/api` (i.e. unmodified WishKit behaviour)

`WishKit.FeedbackListView()` and `WishKit.BugReportView()` are the two public SwiftUI surfaces. Both work as `.sheet` content inside a `NavigationStack`.

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
swift test          # WishKit Swift tests
pnpm typecheck      # TS for shared package + web app
pnpm test           # vitest (45+ cases covering SDK + admin + passkey + rate-limit flows)
pnpm build          # vite build (regenerates the route tree)
```

## Credits & license

- **WishKit Swift package** — © 2023 Martin Lasek, [MIT](https://github.com/wishkit/wishkit-ios/blob/main/LICENSE). The package in `Sources/WishKit` and the `wishkit-ios-shared` 1.5.0 dependency it pulls from `https://github.com/wishkit/wishkit-ios-shared` are unchanged from upstream beyond the `apiUrl` configure parameter and the new `BugReportView`. If you use OpenWish, also star/sponsor the original WishKit project — none of this exists without it.
- **OpenWish server, dashboard, and bug-report extensions** — same MIT license; see `LICENSE`.
