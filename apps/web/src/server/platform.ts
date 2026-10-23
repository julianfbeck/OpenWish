import type { IssueContext, Platform } from "@openwish/shared";

// Both SDKs identify themselves on every request: the Swift SDK sends
// `x-wishkit-sdk-kind: ios`, the Android SDK `android`. Anything else (web
// form, MCP, CLI, unknown clients) has no platform.
export function platformFromRequest(request: Request): Platform | null {
  const kind = request.headers.get("x-wishkit-sdk-kind")?.trim().toLowerCase();
  return kind === "ios" || kind === "android" ? kind : null;
}

function field(context: IssueContext, group: string, key: string): unknown {
  const value = context[group];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

// V2 issues also carry the SDK's automatic context, which identifies the
// platform when a client omits the header.
export function platformFromContext(context: IssueContext): Platform | null {
  if (field(context, "sdk", "name") === "openwish-android" || field(context, "device", "androidVersion") !== undefined) {
    return "android";
  }
  if (field(context, "sdk", "name") === "OpenWish" || field(context, "app", "bundleId") !== undefined) {
    return "ios";
  }
  return null;
}
