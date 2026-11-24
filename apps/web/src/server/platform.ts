import { isPlatform, type IssueContext, type Platform } from "@openwish/shared";

// Both SDKs identify themselves on every request: the Swift SDK sends
// `x-wishkit-sdk-kind: ios` (or `macos` from 1.2 on a Mac), the Android SDK
// `android`. Anything else (web form, MCP, CLI, unknown clients) has no
// platform.
export function platformFromRequest(request: Request): Platform | null {
  const kind = request.headers.get("x-wishkit-sdk-kind")?.trim().toLowerCase();
  return isPlatform(kind) ? kind : null;
}

function field(context: IssueContext, group: string, key: string): unknown {
  const value = context[group];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function isMacName(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "macos";
}

// V2 issues also carry the SDK's automatic context, which identifies the
// platform when a client omits the header. Older Swift SDKs on a Mac only
// reveal it through app-supplied context (`platform: "macOS"`).
export function platformFromContext(context: IssueContext): Platform | null {
  if (field(context, "sdk", "name") === "openwish-android" || field(context, "device", "androidVersion") !== undefined) {
    return "android";
  }
  if (isMacName(field(context, "device", "platform")) || isMacName(context.platform)) {
    return "macos";
  }
  if (field(context, "sdk", "name") === "OpenWish" || field(context, "app", "bundleId") !== undefined) {
    return "ios";
  }
  return null;
}

// Platform of a V2 issue. Swift SDKs before 1.2 send `ios` from a Mac too, so
// context that says macOS wins over that header.
export function issuePlatform(request: Request, context: IssueContext): Platform | null {
  const fromHeader = platformFromRequest(request);
  const fromContext = platformFromContext(context);
  if (fromContext === "macos" && (fromHeader === null || fromHeader === "ios")) return "macos";
  return fromHeader ?? fromContext;
}
