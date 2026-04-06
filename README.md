# OpenWish

OpenWish is a Cloudflare-hostable replacement backend and web surface for the `WishKit` Swift SDK in this repository.

The Swift library under `Sources/WishKit` is intentionally left intact. OpenWish adds:

- a Hono API for Cloudflare Workers
- a D1 schema for wishes, votes, comments, users, and projects
- a React public feedback board
- a React admin panel
- shared TypeScript contracts that mirror the Swift payloads

## Repo Layout

- `Sources/WishKit`: existing Swift package and UI library
- `apps/api`: Cloudflare Worker API
- `apps/web`: React frontend for public board and admin
- `packages/shared`: shared request/response types

## Swift Compatibility

The Worker mirrors the API shape expected by the existing Swift SDK:

- `GET /api/wish/list`
- `POST /api/wish/create`
- `POST /api/wish/vote`
- `POST /api/comment/create`
- `POST /api/user/update`

Important: the untouched Swift SDK still defaults to `https://www.wishkit.io/api` in [ProjectSettings.swift](/Users/julianbeck/Development/swift/OpenWish/Sources/WishKit/ProjectSettings.swift). To use OpenWish in an app without changing the library, you need to set the `wishkit-url` process environment variable to your OpenWish API base URL at runtime.

## Local Development

Install workspace dependencies:

```bash
npm install
```

Run the API locally:

```bash
npm run dev:api
```

Run the web app locally:

```bash
npm run dev:web
```

The web app defaults to `http://127.0.0.1:8787` for the API. Override it with `VITE_OPENWISH_API_BASE_URL` if needed.

## Cloudflare Deployment

Create the D1 database:

```bash
npx wrangler@4.80.0 d1 create openwish
```

Copy the returned `database_id` into [apps/api/wrangler.toml](/Users/julianbeck/Development/swift/OpenWish/apps/api/wrangler.toml).

Apply migrations:

```bash
npx wrangler@4.80.0 d1 migrations apply openwish --config apps/api/wrangler.toml
```

Set the bootstrap secret used by the admin panel:

```bash
npx wrangler@4.80.0 secret put OPENWISH_BOOTSTRAP_TOKEN --config apps/api/wrangler.toml
```

Optionally set the allowed browser origin:

```bash
npx wrangler@4.80.0 secret put OPENWISH_CORS_ORIGIN --config apps/api/wrangler.toml
```

Deploy the API:

```bash
npx wrangler@4.80.0 deploy --config apps/api/wrangler.toml
```

Build the frontend:

```bash
npm run build --workspace @openwish/web
```

Deploy `apps/web/dist` to Cloudflare Pages with:

```bash
VITE_OPENWISH_API_BASE_URL=https://your-api-domain.example.com
```

## Admin Flow

1. Open `/admin/<slug>`.
2. Create a project with the bootstrap token.
3. Save the returned API key and admin token.
4. Reload the same route with the admin token.
5. Use the public board at `/projects/<slug>`.

## Verification

These checks pass in the current workspace:

```bash
swift test
npm run typecheck --workspace @openwish/shared
npm run typecheck --workspace @openwish/api
npm run test --workspace @openwish/api
npm run typecheck --workspace @openwish/web
npm run build --workspace @openwish/web
```

## Current Scope

OpenWish currently supports:

- project bootstrap and per-project admin tokens
- public wish creation, voting, and comments
- admin roadmap state changes and admin comments
- watermark toggling
- shared request/response contracts aligned with the Swift client
