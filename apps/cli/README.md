# openwish CLI

A small, dependency-free Go CLI for the OpenWish **global API** (`/api/v1`). It
reads and writes feature requests and bug reports across **every** project using
a single global API key.

## Build

```bash
cd apps/cli
go build -o openwish .      # produces ./openwish
# or run directly: go run . <command>
```

## Configure

The CLI needs the worker URL and the global API key. Flags override env vars.

| Setting | Env var | Flag | Default |
| --- | --- | --- | --- |
| Base URL | `OPENWISH_API_URL` | `--url` | `https://wishkit.juli.sh` |
| Global key | `OPENWISH_API_KEY` | `--key` | — (required) |

The key is the server's `OPENWISH_GLOBAL_API_KEY` secret. Treat it like a root
credential: it can read and write every project.

```bash
export OPENWISH_API_KEY="ow_global_…"
export OPENWISH_API_URL="https://wishkit.juli.sh"   # optional
```

## Commands

```bash
openwish projects list
openwish projects create --slug my-app --name "My App" [--watermark]

openwish wishes list   --project my-app
openwish wishes create --project my-app --title "Dark mode" --description "Please add it" [--email a@b.com] [--state pending]

openwish bugs list   --project my-app
openwish bugs create --project my-app --title "Crash" --description "Crashes on launch" [--email a@b.com]
```

Add `--json` to any command to print the raw API response instead of a table.

## Exit codes

`0` success · `1` request/transport error (prints the server's message) · `2` bad usage.
