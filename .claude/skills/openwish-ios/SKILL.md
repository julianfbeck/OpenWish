---
name: openwish-ios
description: Wire WishKit + the OpenWish self-hosted Cloudflare backend into a Swift/SwiftUI iOS app. Use when the user wants to add in-app feature requests or bug reports backed by an OpenWish deployment, points an existing WishKit integration at their own host, or adds the bug-report sheet (with screenshot uploads) to their app.
---

# OpenWish iOS client integration

OpenWish is the self-hosted Cloudflare backend for [WishKit](https://github.com/wishkit/wishkit-ios). The iOS side is the upstream WishKit Swift package with two additions:

- `WishKit.configure(with:apiUrl:)` — point the SDK at your OpenWish host instead of `wishkit.io`.
- `WishKit.BugReportView()` — a new submit-only sheet that lets users file bug reports with up to **4 screenshots**, optional contact email, and view their previously-submitted bugs with admin replies.

The existing `WishKit.FeedbackListView()` for feature requests / wishes is unchanged from upstream WishKit and works against an OpenWish host because the API contract is preserved byte-for-byte.

## When to invoke this skill

- "Add WishKit to this iOS app and point it at my OpenWish server"
- "Show feature requests / a bug report sheet in my app"
- "Add screenshot uploads to my feedback form"
- "Wire `WishKit.configure` to my Cloudflare backend at https://feedback.example.com/api"
- Any time the user references `OpenWish`, `wishkit.juli.sh`, or a self-hosted WishKit-style backend.

## Pre-requisites the user must have

1. **An OpenWish deployment** — they should already have a host like `https://feedback.example.com` running the worker. If not, point them at [`apps/web/README.md`](../../../apps/web/README.md) for the Cloudflare setup.
2. **A project API key** — created from the OpenWish dashboard's Projects page (`/dashboard/projects`). Format: `ow_api_<32 hex chars>`.
3. **iOS deployment target ≥ 16** if they want the screenshot picker. The bug-report compose form gracefully degrades on iOS 14/15 (text-only — the picker shows a `Screenshot uploads require iOS 16 or newer.` hint).
4. **iOS deployment target ≥ 15** for the bug-report list / detail screens (uses `@Environment(\.dismiss)` and async/await on URLSession).

If they're below iOS 15, only the existing WishKit feature-request flow is available.

## Step 1 — add the WishKit Swift package

Two flavours:

### A. Use the upstream WishKit package

If your fork of WishKit is the canonical OpenWish-aware build, add it via Xcode → File → Add Package Dependencies → URL `https://github.com/wishkit/wishkit-ios.git` (or the OpenWish fork URL). When upstream eventually merges the `apiUrl` patch and the bug-report view, this is the only step needed.

### B. Use the local OpenWish repository

If the user is in this monorepo (or has it cloned locally), add a local package dependency in their `Package.swift`:

```swift
.package(path: "../OpenWish")
```

…and depend on the `WishKit` product. Xcode handles this via File → Add Local Package... The example app at `ExampleApp/openwish` does exactly this.

## Step 2 — configure at app launch

Edit the `@main` `App` struct (or the `AppDelegate` `application(_:didFinishLaunchingWithOptions:)` for UIKit apps):

```swift
import SwiftUI
import WishKit

@main
struct MyApp: App {
    init() {
        WishKit.configure(
            with: "ow_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",   // Project API key from the OpenWish dashboard
            apiUrl: "https://feedback.example.com/api"           // Your OpenWish host + /api
        )
    }

    var body: some Scene {
        WindowGroup { ContentView() }
    }
}
```

**Important**:
- `apiUrl` must be `https://<your-host>/api` — include `/api`, no trailing slash.
- The API key is bound to a single project. If the app supports multiple environments (dev/prod) configure once per build configuration, e.g. via an `xcconfig`-driven `Bundle.main.object(forInfoDictionaryKey:)` lookup.
- Calling `WishKit.configure` more than once is fine — it just updates the static state.

## Step 3 — surface the SwiftUI views

Both views must be presented inside a `NavigationStack` because their internal "+" / row navigation uses `NavigationLink`. Use them as `.sheet` content:

```swift
import SwiftUI
import WishKit

struct ContentView: View {
    @State private var showFeedback = false
    @State private var showBug = false

    var body: some View {
        VStack(spacing: 16) {
            Button("Send feedback") { showFeedback = true }
                .buttonStyle(.borderedProminent)
            Button("Report a bug") { showBug = true }
                .buttonStyle(.bordered)
        }
        .sheet(isPresented: $showFeedback) {
            NavigationStack { WishKit.FeedbackListView() }
        }
        .sheet(isPresented: $showBug) {
            NavigationStack { WishKit.BugReportView() }
        }
    }
}
```

`WishKit.BugReportView()` opens to a list of the **current user's** bug reports (filtered server-side by `x-wishkit-uuid`). The "+" floating button pushes the compose form. Tapping a row pushes a detail screen showing description, status pill, and admin replies in a chat thread.

## Step 4 — (optional) identify the user

WishKit/OpenWish key submissions by an SDK-managed UUID stored on the device. To attach extra context the admin can see, call any of these once you know the user (e.g. after sign-in):

```swift
WishKit.updateUser(email: "user@example.com")    // shows up under "Reported by" in the bug detail dialog
WishKit.updateUser(name: "Jane Doe")
WishKit.updateUser(customID: "internal-id-123")  // your own correlation id
```

Skip this if you want fully anonymous reports — the SDK still works.

## Step 5 — (optional) theming

The SDK ships with a configurable `WishKit.theme` (primary color, surfaces, etc.) and `WishKit.config.buttons.addButton.location` (`.floating` or `.navigationBar`). Set these once at app launch alongside `configure`. Defaults match the OpenWish dark theme reasonably well; only override if your app's brand is bright-mode primary.

## What the user gets

- **Feature requests** — `WishKit.FeedbackListView()` shows the public roadmap board, a state-filter chip strip (`All / Pending / In review / Planned / In progress / Completed` with counts), upvoting, comments, and a "+" to submit a new wish. State changes you make in the OpenWish dashboard show up here in real time (after the user pulls to refresh).
- **Bug reports** — `WishKit.BugReportView()` is submit-first with a list of the user's own reports underneath. Reports include up to 4 screenshots; admin replies show as bubbles with an "Admin" pill.
- **Push-style updates** — there's no APNS today; the user sees admin updates on next list fetch (or pull-to-refresh).
- **Email follow-up** — when the user fills the optional Email field on a bug report, the admin can reply directly to that address from the dashboard's "Reported by" link.

## Smoke test the integration

1. Run the app in the simulator. Tap "Send feedback" — empty list with a "+" should appear within ~1 second.
2. Submit a wish; it should appear in the OpenWish dashboard at `https://<your-host>/dashboard/<project-slug>` under **Pending**.
3. Tap "Report a bug" → "+", fill title/description, attach a screenshot, send. It lands at `/dashboard/<project-slug>/bugs`.
4. From the dashboard, change the bug's state to "In progress" and add a comment. Re-open the app's bug list and tap the row — the new state and comment appear in the detail screen.
5. If `OPENWISH_NOTIFICATION_FROM` and the project's notification email are configured on the server, every new wish/bug also triggers a notification email.

## Common pitfalls

- **`401 missingApiHeaderKey`** — `WishKit.configure(with:)` wasn't called before the first SDK call, or the wrong string was passed. The API key must start with `ow_api_`. The project slug is **not** an API key.
- **`401` from a project that worked yesterday** — the dashboard might have deleted the project; create a new one and update the key.
- **`429 Retry-After: …` in the Xcode console** — the OpenWish rate limiter tripped. Caps are 30 writes/minute and 120 reads/minute per device. Either back off or increase the caps in `apps/web/src/server/rate-limit.ts`.
- **Feedback sheet shows but the floating "+" does nothing** — `WishKit.FeedbackListView()` was rendered without a surrounding `NavigationStack`. Wrap it.
- **`keyNotFound("id")` on comment/vote/bug response decode** — happens when the server returns an error envelope (`{reason:"…"}`) and the SDK tries to decode it as a success type. Look at the worker's `wrangler tail` for the actual reason. Common causes: rate limited, project deleted, invalid wishId/screenshotKey.
- **Screenshot uploads fail with `400`** — content-type not in `image/jpeg|png|heic|webp`, or body > 5 MB. The bug-report sheet does magic-number sniffing client-side; if you're calling the SDK manually, set the right `Content-Type`.
- **Screenshot uploads fail with `413`** — body exceeded 5 MB. Resize before uploading.

## File pointers

- `Sources/WishKit/WishKit.swift` — public surface, `configure`, `FeedbackListView`, `BugReportView`.
- `Sources/WishKit/API/BugApi.swift` — bug create + screenshot upload + list endpoints.
- `Sources/WishKit/Bug/CreateBugRequest.swift` — request shape (`title`, `description`, `email?`, `screenshotKeys[]`).
- `Sources/WishKit/SwiftUI/BugReportView.swift` — the list/compose/detail SwiftUI views.
- `apps/web/README.md` — server hosting docs.
- `ExampleApp/openwish/openwish/` — minimal reference Xcode project (gitignored, but checked-out in the monorepo).

## What NOT to do

- Don't depend on `wishkit-ios-shared` for the bug types — those live under `Sources/WishKit/Bug/` because shared 1.5.0 is locked. Always import from the WishKit package directly.
- Don't try to call `/api/wish/list` or any SDK route from the app's own networking layer to "skip WishKit" — the SDK adds the required `x-wishkit-uuid` and signature headers, and the server returns 401 without them.
- Don't hard-code admin tokens or the bootstrap token into the app. Both are server-only secrets.
- Don't build the BugReportView inside a `Sheet` without a `NavigationStack`. The "+" is a `NavigationLink` and silently does nothing without one.
