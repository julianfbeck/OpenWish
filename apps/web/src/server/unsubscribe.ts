import type { Bindings } from "./types";

// Stateless, signed unsubscribe tokens. A token encodes `${projectId}:${userUuid}`
// (base64url) plus an HMAC-SHA256 signature over that payload. We reuse the
// dashboard session secret as the signing key so no new secret is required.
//
// Token format: `<payloadB64Url>.<sigB64Url>`. Verification recomputes the HMAC
// and constant-time compares, so a tampered payload or signature is rejected.

const encoder = new TextEncoder();

function base64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of arr) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(value: string): string | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    return atob(padded);
  } catch {
    return null;
  }
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return base64urlEncode(signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function secretFor(env: Bindings): string | null {
  return env.OPENWISH_DASHBOARD_SESSION_SECRET ?? null;
}

export async function signUnsubscribeToken(
  env: Bindings,
  projectId: string,
  userUuid: string,
): Promise<string | null> {
  const secret = secretFor(env);
  if (!secret) {
    return null;
  }
  const payload = base64urlEncode(encoder.encode(`${projectId}:${userUuid}`));
  const signature = await hmac(secret, payload);
  return `${payload}.${signature}`;
}

export async function verifyUnsubscribeToken(
  env: Bindings,
  token: string,
): Promise<{ projectId: string; userUuid: string } | null> {
  const secret = secretFor(env);
  if (!secret) {
    return null;
  }

  const dotIndex = token.indexOf(".");
  if (dotIndex <= 0) {
    return null;
  }
  const payload = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);

  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(signature, expected)) {
    return null;
  }

  const decoded = base64urlDecode(payload);
  if (decoded === null) {
    return null;
  }
  const sep = decoded.indexOf(":");
  if (sep <= 0 || sep === decoded.length - 1) {
    return null;
  }
  return {
    projectId: decoded.slice(0, sep),
    userUuid: decoded.slice(sep + 1),
  };
}
