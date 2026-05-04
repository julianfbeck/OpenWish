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
| New-wish / new-bug / test notifications | Email Routing send binding | `NOTIFICATION_EMAIL` |
| Dashboard session secret, admin password, passkey RP config | Worker secrets / vars | see below |

---

## One-time setup

All commands assume you're inside `apps/web`. Replace `openwish` / `openwish-bugs` / `openwish-ratelimit` with your own resource names if you prefer.

```bash
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
  "compatibility_flags": ["nodejs_compat"],

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
| `OPENWISH_PASSKEY_RP_ID` | required for passkeys | Must equal the host (no scheme, no port). E.g. `wishkit.example.com`. |
| `OPENWISH_PASSKEY_RP_NAME` | optional | Shown in the OS passkey prompt. |
| `OPENWISH_TURNSTILE_SITE_KEY` | required for the public form | Public site key from `dash.cloudflare.com → Turnstile → Add site`. Embedded in the `/feedback/<slug>` page. |

### Secrets

| Secret | Required | Notes |
| --- | --- | --- |
| `OPENWISH_DASHBOARD_USERNAME` | yes | The single admin identity. Once a passkey is registered, password sign-in is auto-locked but this var still defines the user the passkey is bound to. |
| `OPENWISH_DASHBOARD_PASSWORD` | yes (initial) | Used for the very first sign-in so you can register a passkey. After at least one passkey exists, every password attempt returns 401. Delete rows in `auth_passkeys` to re-enable it. |
| `OPENWISH_DASHBOARD_SESSION_SECRET` | yes | HMAC key for the 7-day signed session cookie. Generate with `openssl rand -base64 48`. |
| `OPENWISH_BOOTSTRAP_TOKEN` | optional | If set, allows `POST /api/admin/projects/bootstrap` to create projects without a dashboard session. Useful for the very first project before you log in. **Delete after first use** for the strongest posture. |
| `OPENWISH_TURNSTILE_SECRET_KEY` | required for the public form | Server-side secret paired with the site key above. Used on `siteverify` calls. Set with `wrangler secret put OPENWISH_TURNSTILE_SECRET_KEY`. |

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

### Public feedback page

Browsers can submit bug reports or feature requests to a project at `https://<your-host>/feedback/<slug>` once you flip the **Public feedback form** toggle on the project's dashboard page. The page renders a Cloudflare Turnstile widget; `OPENWISH_TURNSTILE_SITE_KEY` (var) and `OPENWISH_TURNSTILE_SECRET_KEY` (secret) must be set or the page will show a configuration warning. This URL is what you'd put in App Store Connect's app-support field so testers and end users have a way to reach you without needing an iOS install. Cloudflare's documented dummy keys (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`) always pass and are fine for local dev — see `.dev.vars.example`.

---

## Migrations

Live in `migrations/`. Each new schema change ships as `00NN_description.sql`. The runtime mirror in `src/server/db.ts` (`schemaStatements`) keeps fresh DBs working without applying migrations, but on remote D1 you should still:

```bash
pnpm exec wrangler d1 migrations apply openwish --remote
```

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
