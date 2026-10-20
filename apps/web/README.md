# OpenWish Server

This directory is the OpenWish server: a single TanStack Start app that ships as a Cloudflare Worker, hosts the admin dashboard, the Swift SDK API surface, and the bug-report screenshot store.

It is the **self-hosted counterpart to [WishKit](https://github.com/wishkit/wishkit-ios)** by Martin Lasek. The Swift SDK in `Sources/OpenWish/` is a fork of the upstream WishKit package (renamed from `WishKit` → `OpenWish`) and talks to whatever host you point it at — this is what you deploy on the other end.

---

## What you need before you start

1. **A Cloudflare account.** Free tier is enough for a small instance; D1, R2, KV, Email Routing and Workers all have generous free quotas.
2. **A domain on Cloudflare.** Email-sending and the custom-domain Worker route both need the domain's nameservers pointed at Cloudflare. Email Routing in particular requires the zone to be on Cloudflare.
3. **The Wrangler CLI.** Either let pnpm provide it via the workspace (`pnpm exec wrangler …`) or install globally (`npm i -g wrangler`). Run `wrangler login` once to authenticate via OAuth.
4. **Node ≥ 22 and pnpm ≥ 9** (see the workspace's root `package.json` engines field).

That's it — no Docker, no Postgres, no separate Node/Bun host. The whole stack runs on Cloudflare's edge.

---

## What lives where

| Concern | Cloudflare resource | Binding in `wrangler.jsonc` |
| --- | --- | --- |
| Wishes / bugs / users / comments / projects / passkeys | D1 SQLite database | `DB` |
| Bug screenshots | R2 bucket | `BUGS_BUCKET` |
| Rate-limit counters (fixed-window) | Workers KV | `RATE_LIMIT_KV` |
| New-wish / new-bug / new-comment / test notifications (to **you**, the admin) | Email Routing send binding | `NOTIFICATION_EMAIL` |
| Reporter notifications (to **the user** — admin reply / "fixed" / "implemented") | Cloudflare Email Service (HTTP API) | `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_EMAIL_API_TOKEN` |
| Dashboard session secret, admin password, passkey RP config | Worker secrets / vars | see below |

---

## One-time setup

All commands assume you're inside `apps/web`. Replace `openwish` / `openwish-bugs` / `openwish-ratelimit` with your own resource names if you prefer.

```bash
# 0) Copy the wrangler config template. wrangler.jsonc is gitignored so
#    your D1/KV/R2 ids and custom domain stay out of version control.
cp wrangler.example.jsonc wrangler.jsonc

# 1) D1 database
pnpm exec wrangler d1 create openwish
# → copy the printed `database_id` into wrangler.jsonc under d1_databases[0].database_id

# 2) R2 bucket for screenshots
pnpm exec wrangler r2 bucket create openwish-bugs

# 3) KV namespace for rate limiting
pnpm exec wrangler kv namespace create openwish-ratelimit
# → copy the printed `id` into wrangler.jsonc under kv_namespaces[0].id

# 4) Apply migrations to the new D1
pnpm exec wrangler d1 migrations apply openwish --remote

# 5) Set dashboard secrets
pnpm exec wrangler secret put OPENWISH_DASHBOARD_USERNAME
pnpm exec wrangler secret put OPENWISH_DASHBOARD_PASSWORD
pnpm exec wrangler secret put OPENWISH_DASHBOARD_SESSION_SECRET   # any 32+ char random string
pnpm exec wrangler secret put OPENWISH_BOOTSTRAP_TOKEN            # optional, see below

# 6) Email Routing
#    a) Enable Email Routing on the zone you own (Cloudflare dashboard → Email → Email Routing).
#    b) Add at least one verified destination address (the inbox you want notifications at).
#    Cloudflare will only deliver to verified destinations — this is enforced by the platform,
#    independent of the Worker code.

# 7) Deploy
pnpm run deploy
```

`pnpm run deploy` runs `vite build` (which regenerates `routeTree.gen.ts`) and then `wrangler deploy`. **Don't run `wrangler deploy` directly** — it skips the build step and ships a stale bundle.

---

## `wrangler.jsonc` reference

```jsonc
{
  "name": "openwish",
  "main": "src/server.ts",
  "compatibility_date": "2026-04-09",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],

  "durable_objects": {
    "bindings": [
      { "name": "MCP_OAUTH_STATE", "class_name": "OpenWishOAuthState" }
    ]
  },

  "migrations": [
    { "tag": "mcp-oauth-v1", "new_sqlite_classes": ["OpenWishOAuthState"] }
  ],

  "routes": [
    { "pattern": "wishkit.example.com", "custom_domain": true }
  ],

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "openwish",
      "database_id": "<from `wrangler d1 create`>",
      "migrations_dir": "./migrations"
    }
  ],

  "r2_buckets": [
    { "binding": "BUGS_BUCKET", "bucket_name": "openwish-bugs" }
  ],

  "kv_namespaces": [
    { "binding": "RATE_LIMIT_KV", "id": "<from `wrangler kv namespace create`>" }
  ],

  "send_email": [
    { "name": "NOTIFICATION_EMAIL" }
  ],

  "vars": {
    "OPENWISH_MCP_OAUTH_ORIGIN": "https://wishkit.example.com",
    "OPENWISH_CORS_ORIGIN": "https://wishkit.example.com",
    "OPENWISH_NOTIFICATION_FROM": "noreply@example.com",
    "OPENWISH_DASHBOARD_URL": "https://wishkit.example.com",
    "OPENWISH_PASSKEY_RP_ID": "wishkit.example.com",
    "OPENWISH_PASSKEY_RP_NAME": "OpenWish",
    "OPENWISH_TURNSTILE_SITE_KEY": "<from dash.cloudflare.com → Turnstile>"
  }
}
```

### Vars

| Var | Required | Notes |
| --- | --- | --- |
| `OPENWISH_CORS_ORIGIN` | recommended | Restrict the dashboard SPA's allowed origin. `*` is fine in dev. |
| `OPENWISH_NOTIFICATION_FROM` | required to send emails | Must be on a domain with Email Routing **active**. The recipient still has to be a verified destination address. |
| `OPENWISH_DASHBOARD_URL` | recommended | Public URL the dashboard is served from — used to build the deep-link in notification emails AND as the WebAuthn `expectedOrigin`. |
| `OPENWISH_MCP_OAUTH_ORIGIN` | required for OAuth | Fixed public HTTPS origin for OAuth discovery and endpoints, for example `https://wishkit.juli.sh`. It must match the host used by the MCP client. |
| `OPENWISH_DASHBOARD_SESSION_DAYS` | optional | Dashboard session lifetime in days (default `30`). The session slides — every dashboard load re-issues the cookie — so you stay signed in as long as you visit within the window. |
| `OPENWISH_PASSKEY_RP_ID` | required for passkeys | Must equal the host (no scheme, no port). E.g. `wishkit.example.com`. |
| `OPENWISH_PASSKEY_RP_NAME` | optional | Shown in the OS passkey prompt. |
| `OPENWISH_TURNSTILE_SITE_KEY` | required for the public form | Public site key from `dash.cloudflare.com → Turnstile → Add site`. Embedded in the `/feedback/<slug>` page. |
| `CLOUDFLARE_ACCOUNT_ID` | required for reporter emails | Your Cloudflare account id. Paired with the `CLOUDFLARE_EMAIL_API_TOKEN` secret to send reporter notifications via Cloudflare Email Service. |

### Secrets

| Secret | Required | Notes |
| --- | --- | --- |
| `OPENWISH_DASHBOARD_USERNAME` | yes | The single admin identity. Once a passkey is registered, password sign-in is auto-locked but this var still defines the user the passkey is bound to. |
| `OPENWISH_DASHBOARD_PASSWORD` | yes (initial) | Used for the very first sign-in so you can register a passkey. After at least one passkey exists, every password attempt returns 401. Delete rows in `auth_passkeys` to re-enable it. |
| `OPENWISH_DASHBOARD_SESSION_SECRET` | yes | HMAC key for the signed dashboard session cookie (30 days by default). Generate with `openssl rand -base64 48`. |
| `OPENWISH_BOOTSTRAP_TOKEN` | optional | If set, allows `POST /api/admin/projects/bootstrap` to create projects without a dashboard session. Useful for the very first project before you log in. **Delete after first use** for the strongest posture. |
| `OPENWISH_TURNSTILE_SECRET_KEY` | required for the public form | Server-side secret paired with the site key above. Used on `siteverify` calls. Set with `wrangler secret put OPENWISH_TURNSTILE_SECRET_KEY`. |
| `CLOUDFLARE_EMAIL_API_TOKEN` | required for reporter emails | API token with the `email_sending:write` scope (create at `dash.cloudflare.com/profile/api-tokens`). Set with `wrangler secret put CLOUDFLARE_EMAIL_API_TOKEN`. |
| `OPENWISH_GLOBAL_API_KEY` | required for the v1/CLI API and global-key MCP access | A single secret authorizing all projects through `/api/v1/**` and `/mcp`. Generate with `openssl rand -base64 32`; set with `wrangler secret put OPENWISH_GLOBAL_API_KEY`. Authenticated dashboard users can reveal/copy it under Projects → Agent access (MCP). OAuth grants use their own tokens and project permissions. |

---

## Reporter notifications (emails to your users)

When an admin **replies to** or marks a bug **fixed** / a feature request **implemented** in the dashboard, OpenWish emails the person who reported it. These are separate from the admin notifications above:

- **Admin notifications** (new wish/bug or user comment landed) go to your own verified inbox over Email Routing (`NOTIFICATION_EMAIL`).
- **Reporter notifications** go to arbitrary end-user addresses, which Email Routing cannot do — so they use **[Cloudflare Email Service](https://developers.cloudflare.com/email-routing/email-workers/)** (the transactional HTTP API, public beta).

Prerequisites:

1. A **Workers Paid** plan ($5/mo) — Email Service requires it.
2. Your sender domain **onboarded** under `dash.cloudflare.com → Email → Email Sending → Onboard Domain` (adds SPF/DKIM/DMARC + the `cf-bounce` MX records).
3. An API token with **`email_sending:write`** → set as the `CLOUDFLARE_EMAIL_API_TOKEN` secret.
4. Your account id → set as the `CLOUDFLARE_ACCOUNT_ID` var.

Behavior & guarantees:

- A send is fired only when the reporter has an email on file (bugs use the report's `reporter_email`, falling back to the user's saved email; wishes use the user's saved email) **and** hasn't unsubscribed.
- Status emails fire only on a *real transition* into the done state (`fixed` / `implemented`) — re-saving an already-done item sends nothing.
- Every reporter email carries an unsubscribe link (`/api/public/unsubscribe?token=…`, an HMAC-signed token) plus a `List-Unsubscribe` header. Unsubscribing is per-reporter, per-project.
- Sending is **best-effort**: if the credentials are missing or the API rejects the send, the admin action still succeeds and the failure is only logged. Until it's configured, reporter emails are silently skipped — so local dev needs no setup.

> Email Service is a young product. If you want to be conservative, watch deliverability on these lower-stakes notifications before relying on Cloudflare for anything higher-stakes.

---

## After the first deploy

1. Visit `https://<your-host>/login`, sign in once with the username/password.
2. Open Projects → **Add passkey on this device**, complete Touch ID / Face ID / your security-key flow.
3. Sign out — the login page now shows only the passkey button. Repeat step 2 from each device you'll use.
4. (Optional, recommended) Delete the bootstrap secret once you've created your projects: `pnpm exec wrangler secret delete OPENWISH_BOOTSTRAP_TOKEN`.

To register your first project programmatically (instead of via the dashboard), you can bootstrap with:

```bash
curl -X POST https://<your-host>/api/admin/projects/bootstrap \
  -H "Content-Type: application/json" \
  -H "x-openwish-bootstrap-token: <your-bootstrap-token>" \
  -d '{"name":"My App","slug":"my-app","watermarkEnabled":false}'
```

The response carries the `apiKey` you pass to `OpenWish.configure(with:apiUrl:)`.

---

## What's exposed publicly

### SDK surface (the iOS apps using OpenWish)

Auth: `x-wishkit-api-key` + `x-wishkit-uuid`. Rate-limited per (apiKey, uuid) and per apiKey.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/wish/list` | Existing OpenWish contract |
| POST | `/api/wish/create` | Existing OpenWish contract |
| POST | `/api/wish/vote` | Existing OpenWish contract |
| POST | `/api/comment/create` | Existing OpenWish contract |
| POST | `/api/user/update` | Existing OpenWish contract |
| POST | `/api/bug/screenshot` | Raw image bytes (`image/jpeg|png|heic|webp`, ≤5 MB). Returns the R2 key. |
| POST | `/api/bug/create` | JSON `{ title, description, email?, screenshotKeys[] }` |
| GET | `/api/bug/list` | Filtered to the caller's UUID — users see only their own reports |

### Admin / dashboard surface

Auth: signed `openwish_dashboard_session` cookie issued by `/api/auth/login` or `/api/auth/passkey/login/verify`.

- `GET/POST/DELETE /api/admin/projects/...` — project CRUD, settings, analytics
- `GET/PATCH/DELETE /api/admin/projects/$slug/wishes/$wishId` — moderation + state transitions
- `GET /api/admin/projects/$slug/bugs` — bug triage list
- `GET /api/admin/projects/$slug/bugs/$bugId/screenshots/$key` — streams a screenshot from R2 (admin-gated, project-scoped)
- `POST /api/admin/projects/$slug/test-email` — sends a test notification
- `GET/POST/DELETE /api/auth/passkey/...` — register, list, revoke passkeys (single-user)

### Public

- `GET /api/auth/passkey/summary` — `{hasPasskey: boolean}` so the login page can show the right CTA
- `POST /api/auth/passkey/login/options` and `POST /api/auth/passkey/login/verify` — the passkey login ceremony
- `GET /api/public/projects/$slug` — minimal project info (`{ name, slug, enabled, turnstileSiteKey }`) used by the public feedback page. Returns 404 when the project doesn't exist OR when its public form is disabled.
- `POST /api/public/feedback/$slug` — accepts `{ kind: "bug" | "wish", title, description, email?, turnstileToken }`. Validates the Turnstile token via `siteverify`, applies an IP-based rate limit (5/min/IP, 60/min/project), then routes to the existing wish/bug create flow. Disabled projects return 404 here too.
- `GET /api/public/unsubscribe?token=…` — one-click unsubscribe target embedded in every reporter notification email. Verifies the HMAC-signed token and, if valid, marks that reporter as unsubscribed for the project (returns a small confirmation page; invalid/tampered tokens return 400).

### Global API (`/api/v1`) — for the CLI and automation

A cross-project programmatic surface authorized by a single global key
(`OPENWISH_GLOBAL_API_KEY`), passed as `Authorization: Bearer <key>` (or the
`x-openwish-api-key` header). Unlike per-project SDK keys, this one key reads and
writes **every** project — keep it server-side only. The [`openwish` Go CLI](../cli)
is the primary consumer.

- `GET /api/v1/projects` — list every project (`slug`, `name`, `appIconUrl`, `createdAt`; never api keys).
- `POST /api/v1/projects` — create a project `{ name, slug, watermarkEnabled? }`; returns the new `apiKey`/`adminToken`.
- `GET /api/v1/projects/$slug/wishes` — list feature requests for a project.
- `POST /api/v1/projects/$slug/wishes` — create one `{ title, description, email?, state? }`.
- `GET /api/v1/projects/$slug/bugs` — list bug reports for a project.
- `POST /api/v1/projects/$slug/bugs` — create one `{ title, description, email?, screenshotKeys? }`.

Missing/invalid key → 401; key not configured on the server → 503; unknown project → 404.

### Remote MCP (`/mcp`) — for coding agents

`POST /mcp` is a stateless Streamable HTTP MCP server built with Cloudflare's
Agents SDK and MCP SDK v2. It accepts existing global API-key bearers and
project-scoped OAuth access tokens through the standard `Authorization` header.

#### Global API-key access

```http
Authorization: Bearer <OPENWISH_GLOBAL_API_KEY>
```

The 20 tools expose the dashboard's complete operational surface: project
CRUD/settings and analytics; feature creation, editing, workflow, replies,
merge, and deletion; bug/card-data issue creation, editing, workflow, replies,
private notes, screenshot reads, and deletion; plus test email. Reply and done
tools preserve dashboard side effects, including reporter emails and explicit
`reporterNotification` results. Destructive tools are annotated and project
deletion requires the slug twice.

The URL and bearer are available only to an authenticated dashboard session at
Projects → Agent access (MCP). The token response is marked `no-store`; do not
put it in source control, logs, prompts, or tool output.

#### OAuth access for ChatGPT

After deploying OAuth support, add `https://wishkit.juli.sh/mcp` (or your own
host's `/mcp`) in ChatGPT's MCP connection settings and choose **OAuth**. Automatic
client registration handles the OAuth client setup. Sign in using the existing
OpenWish dashboard login/passkey and approve the client, selected existing
projects, and permissions shown by the consent page.

For read-only access, if ChatGPT's OAuth settings offer **Base scopes**, use
`mcp:read offline_access`. The server's challenge advertises only `mcp:read`,
so most clients (Cursor included) request read access alone. The consent page
therefore always offers `mcp:write` and `mcp:admin` as unchecked extras marked
"Not requested by this application"; tick them only when the connection should
close, reply to or delete feedback. OpenWish presents a separate, unchecked **Keep this
connection until I revoke it** option on fresh consent pages. Select it explicitly
to permit renewable access; it does not add tool permissions or projects. This
option is also available when ChatGPT requests only `mcp:read`, without adding an
unrequested `offline_access` scope. Issuing a refresh token in that case is
supported by OpenWish's OAuth implementation, but ChatGPT's automatic refresh
behavior for that scope combination requires an approved live expiry test.

| Scope | Permission for selected projects |
| --- | --- |
| `mcp:read` | Default. Read project metadata, analytics, features, issues, private notes, and screenshots. Issue data can include reporter contact and diagnostic information. |
| `mcp:write` | Create/edit feedback, change workflow state, add notes, update project settings, reply to reporters, and send test emails. Replies and resolution changes can send reporter emails. |
| `mcp:admin` | Perform administrative/destructive operations on selected existing projects, including merging or deleting feedback and deleting projects. |
| `offline_access` | Optional client request for refresh access. The owner must explicitly approve the connection lifetime; this scope adds no tool permissions. |

Grants store immutable project IDs. Recreating a deleted project's slug does not
inherit its grants. OAuth never exposes project creation: that global operation
returns new SDK/admin credentials. The global API-key path retains its existing
cross-project behavior.

Authorization codes and pending consent expire after 10 minutes. Access tokens
expire after 15 minutes. Fresh, explicit lifetime approval creates renewable
access without a fixed grant expiry, until the owner revokes it. Leaving the
option unchecked creates no refresh access. Previously issued finite grants
retain their original expiry, and consent pages started under the previous
30-day policy still issue finite grants. Existing grants are never silently
upgraded; persistent access requires a new consent flow.

Each refresh token can be used once and is replaced on a successful refresh.
OpenWish enforces strict rotation over the OAuth provider: reusing a consumed
refresh token returns `invalid_grant` and revokes the entire grant. There is no
retry grace for a consumed token, including after a lost refresh response. The
client must reconnect and approve access again after replay revocation.
Review each connection's duration and revoke access at `/oauth/grants` while
signed in to the dashboard.
Consent and revocation use the dashboard cookie, browser-bound CSRF protection,
and same-origin POSTs.

An until-revoked grant describes OpenWish's authorization policy, not a promise
of uninterrupted client access. DCR client registrations have a 90-day TTL,
renewed by successful token requests after half their lifetime; long inactivity
can expire the registration and require reconnecting. CIMD clients use remote
metadata instead of a stored registration, so metadata and signing keys must
remain available where required. Client behavior, host policies, revocation,
and refresh-token replay can also interrupt access. OpenAI recommends keeping
registered clients valid while a connection is used and planning for refresh
and revocation; its public MCP guidance does not guarantee indefinite automatic
refresh. See the [OpenAI authentication guide](https://developers.openai.com/plugins/build/auth).

Discovery is served at `/.well-known/oauth-protected-resource/mcp` and
`/.well-known/oauth-authorization-server`. The authorization, token, registration,
and revocation endpoints are `/oauth/authorize`, `/oauth/token`,
`/oauth/register`, and `/oauth/revoke`. OAuth uses the authorization-code flow
with PKCE `S256`, Client ID Metadata Documents (CIMD), and Dynamic Client
Registration (DCR). Resource/audience and registered redirect URIs are validated.
See the [OpenAI authentication guide](https://developers.openai.com/plugins/build/auth)
and [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

OAuth-routed requests buffer at most 16 KiB for OAuth endpoints and 256 KiB for
MCP requests, with a five-second body-read deadline before entering the serialized
OAuth queue. Oversized bodies return 413 and slow body uploads return 408.
Durable Object alarms remove expired state in bounded batches, scheduling expiry
work and hourly sweeps; authorization checks enforce expiry independently of
cleanup.

#### OAuth hosting prerequisites

The OAuth source needs the following deployment configuration before clients can
use it on an existing host:

1. Install the declared `@cloudflare/workers-oauth-provider` version `1.2.3`.
2. Merge the `MCP_OAUTH_STATE` binding, SQLite Durable Object migration,
   `global_fetch_strictly_public` flag, and OAuth origin from the tracked
   `wrangler.example.jsonc` into your existing, gitignored `wrangler.jsonc`.
   Preserve production database IDs, bucket/KV bindings, domains, other settings,
   and prior migration entries; append the OAuth migration. The object serializes
   OAuth storage operations. OAuth uses
   this storage independently of the existing D1 feedback database.
3. Set the public origin, for example
   `OPENWISH_MCP_OAUTH_ORIGIN=https://wishkit.juli.sh`, and retain the
   `global_fetch_strictly_public` compatibility flag for public OAuth metadata
   fetches.
4. Keep the existing dashboard login/passkey configuration available, deploy
   the Worker, then authorize the connection through the consent page.

OAuth does not require a new signing secret or an `OAUTH_KV` binding. Installing
the dependency, provisioning the production binding/migration, deploying, and
granting access are separate operational actions; local source changes alone
do not establish a live connection.

### Public feedback page

Browsers can submit bug reports or feature requests to a project at `https://<your-host>/feedback/<slug>` once you flip the **Public feedback form** toggle on the project's dashboard page. The page renders a Cloudflare Turnstile widget; `OPENWISH_TURNSTILE_SITE_KEY` (var) and `OPENWISH_TURNSTILE_SECRET_KEY` (secret) must be set or the page will show a configuration warning. This URL is what you'd put in App Store Connect's app-support field so testers and end users have a way to reach you without needing an iOS install. Cloudflare's documented dummy keys (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`) always pass and are fine for local dev — see `.dev.vars.example`.

---

## Migrations

Live in `migrations/`. Each new schema change ships as `00NN_description.sql`. The runtime mirror in `src/server/db.ts` (`schemaStatements`) keeps fresh DBs working without applying migrations, but on remote D1 you should still:

```bash
pnpm exec wrangler d1 migrations apply openwish --remote
```

Migration `0009_v2_issues.sql` must be applied before V2 clients submit
diagnostic context, card-data issues, or MCP private notes. The legacy
WishKit-compatible endpoints continue working before and after this migration.

---

## Local development

```bash
cp .dev.vars.example .dev.vars
# edit dev secrets, then from the repo root:
pnpm dev
```

`vite dev` brings up a local Worker with a local D1 (Cloudflare's `miniflare` under the hood). The first request creates the schema in the local SQLite file via the runtime mirror, so you don't need to run migrations to develop.

For passkeys to work locally, set `OPENWISH_PASSKEY_RP_ID=localhost` and `OPENWISH_DASHBOARD_URL=http://localhost:5173` in `.dev.vars`.

---

## Tests

```bash
pnpm test       # vitest — covers SDK contract, admin routes, passkey flows, rate limiting, mock D1/R2/KV/SendEmail
pnpm typecheck  # tsc on shared + web
pnpm build      # regenerates routeTree.gen.ts and bundles for Cloudflare
```

---

## Credits

- **WishKit** (the upstream Swift library this fork is based on) — © 2023 Martin Lasek, [MIT-licensed](https://github.com/wishkit/wishkit-ios/blob/main/LICENSE). The package in `Sources/OpenWish/` is a renamed fork; `wishkit-ios-shared` 1.5.0 is consumed unmodified. Please also star/sponsor the upstream project at https://github.com/wishkit/wishkit-ios.
- **OpenWish server, dashboard, and bug-report extensions** — same MIT license; see the repo root `LICENSE`.
