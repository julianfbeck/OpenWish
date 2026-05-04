import { publicError, sdkError } from "./http";
import type { Bindings } from "./types";

// Fixed-window rate limiter backed by a single Cloudflare KV namespace.
// Uses a `floor(now / window) * window` bucket key so concurrent writes
// converge on the same counter; reads/writes are eventually consistent so a
// burst can over-count by a small amount, which is acceptable for abuse
// protection (and lets us avoid a strongly-consistent store like D1).

export type RateLimitKind =
  | "sdk-write"
  | "sdk-read"
  | "sdk-screenshot"
  | "sdk-write-project"
  | "sdk-read-project"
  | "public-form-ip"
  | "public-form-project";

type LimitConfig = {
  windowSeconds: number;
  max: number;
};

const LIMITS: Record<RateLimitKind, LimitConfig> = {
  // Per (apiKey + userUuid) — what a single device can do.
  "sdk-write": { windowSeconds: 60, max: 30 },
  "sdk-read": { windowSeconds: 60, max: 120 },
  "sdk-screenshot": { windowSeconds: 60, max: 10 },
  // Per apiKey — sanity caps so a rogue device can't burn the whole quota.
  "sdk-write-project": { windowSeconds: 60, max: 300 },
  "sdk-read-project": { windowSeconds: 60, max: 600 },
  // Public feedback form: tighter caps because there's no API key in play
  // and Turnstile is the primary line of defense against bots.
  "public-form-ip": { windowSeconds: 60, max: 5 },
  "public-form-project": { windowSeconds: 60, max: 60 },
};

export type RateLimitDecision =
  | { ok: true }
  | { ok: false; response: Response };

function buildKey(kind: RateLimitKind, identifier: string, windowStart: number) {
  return `rl:${kind}:${identifier}:${windowStart}`;
}

async function consume(
  kv: KVNamespace,
  kind: RateLimitKind,
  identifier: string,
): Promise<{ allowed: boolean; resetIn: number }> {
  const config = LIMITS[kind];
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSec / config.windowSeconds) * config.windowSeconds;
  const resetAt = windowStart + config.windowSeconds;
  const resetIn = Math.max(1, resetAt - nowSec);
  const key = buildKey(kind, identifier, windowStart);

  let current = 0;
  try {
    current = parseInt((await kv.get(key)) ?? "0", 10);
  } catch (error) {
    console.error("rate-limit get failed", { kind, key, error: String(error) });
    return { allowed: true, resetIn };
  }

  if (current >= config.max) {
    return { allowed: false, resetIn };
  }

  try {
    await kv.put(key, String(current + 1), {
      expirationTtl: Math.max(60, resetIn + 10),
    });
  } catch (error) {
    console.error("rate-limit put failed", { kind, key, error: String(error) });
  }

  return { allowed: true, resetIn };
}

function tooManyRequests(resetIn: number, errorMode: "sdk" | "public"): Response {
  const response =
    errorMode === "sdk"
      ? sdkError("requestResultedInError", 429)
      : publicError(429, "Too many requests. Please try again shortly.");
  response.headers.set("Retry-After", String(resetIn));
  response.headers.set("X-RateLimit-Reset", String(resetIn));
  return response;
}

type CheckArgs = {
  env: Bindings;
  kinds: Array<{ kind: RateLimitKind; identifier: string }>;
  errorMode?: "sdk" | "public";
};

export async function checkSdkRateLimit({
  env,
  kinds,
  errorMode = "sdk",
}: CheckArgs): Promise<RateLimitDecision> {
  for (const { kind, identifier } of kinds) {
    const { allowed, resetIn } = await consume(env.RATE_LIMIT_KV, kind, identifier);
    if (!allowed) {
      return { ok: false, response: tooManyRequests(resetIn, errorMode) };
    }
  }
  return { ok: true };
}

export type SdkRateLimitInput = {
  env: Bindings;
  apiKey: string;
  userUuid: string;
  kind: "write" | "read" | "screenshot";
};

/**
 * Convenience wrapper for the most common SDK case: enforce both the
 * per-device cap and the per-project sanity cap.
 */
export async function enforceSdkRateLimit({
  env,
  apiKey,
  userUuid,
  kind,
}: SdkRateLimitInput): Promise<RateLimitDecision> {
  const writeKinds: Array<{ kind: RateLimitKind; identifier: string }> = (() => {
    switch (kind) {
      case "write":
        return [
          { kind: "sdk-write", identifier: `${apiKey}:${userUuid}` },
          { kind: "sdk-write-project", identifier: apiKey },
        ];
      case "read":
        return [
          { kind: "sdk-read", identifier: `${apiKey}:${userUuid}` },
          { kind: "sdk-read-project", identifier: apiKey },
        ];
      case "screenshot":
        return [
          { kind: "sdk-screenshot", identifier: `${apiKey}:${userUuid}` },
          { kind: "sdk-write-project", identifier: apiKey },
        ];
    }
  })();

  return checkSdkRateLimit({ env, kinds: writeKinds });
}

export type PublicFormRateLimitInput = {
  env: Bindings;
  ip: string;
  apiKey: string;
};

/**
 * Public feedback form: cap by both IP and project so a single IP can't drown
 * the project, and a botnet hitting one project can't lock out the rest of
 * the platform from a shared global limit.
 */
export async function enforcePublicFormRateLimit({
  env,
  ip,
  apiKey,
}: PublicFormRateLimitInput): Promise<RateLimitDecision> {
  return checkSdkRateLimit({
    env,
    errorMode: "public",
    kinds: [
      { kind: "public-form-ip", identifier: ip },
      { kind: "public-form-project", identifier: apiKey },
    ],
  });
}
