import type { Bindings } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const sessionLifetimeMs = 1000 * 60 * 60 * 24 * 7;
const sessionLifetimeSeconds = sessionLifetimeMs / 1000;
const tokenPrefix = "ows";
export const dashboardSessionCookieName = "openwish_dashboard_session";

type SessionPayload = {
  sub: string;
  exp: number;
};

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function importSessionKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sign(secret: string, value: string) {
  const key = await importSessionKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function getDashboardConfig(env: Bindings) {
  const username = env.OPENWISH_DASHBOARD_USERNAME?.trim();
  const password = env.OPENWISH_DASHBOARD_PASSWORD;
  const sessionSecret = env.OPENWISH_DASHBOARD_SESSION_SECRET?.trim();

  if (!username || !password || !sessionSecret) {
    return null;
  }

  return { username, password, sessionSecret };
}

export function dashboardAuthConfigured(env: Bindings) {
  return getDashboardConfig(env) !== null;
}

export async function createDashboardSessionToken(env: Bindings, username: string) {
  const config = getDashboardConfig(env);
  if (!config) {
    return null;
  }

  const payload: SessionPayload = {
    sub: username,
    exp: Date.now() + sessionLifetimeMs,
  };
  const payloadEncoded = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await sign(config.sessionSecret, payloadEncoded);
  return `${tokenPrefix}.${payloadEncoded}.${signature}`;
}

async function passwordLoginIsLocked(env: Bindings): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT credential_id FROM auth_passkeys LIMIT 1`,
  ).first<{ credential_id: string }>();
  return Boolean(row);
}

export async function authenticateDashboardCredentials(
  env: Bindings,
  username: string,
  password: string,
) {
  const config = getDashboardConfig(env);
  if (!config) {
    return { ok: false as const, reason: "Dashboard login is not configured." };
  }

  if (await passwordLoginIsLocked(env)) {
    return {
      ok: false as const,
      reason:
        "Password sign-in is disabled because at least one passkey is registered. Use your passkey or remove all rows from auth_passkeys to re-enable the password fallback.",
    };
  }

  if (username !== config.username || password !== config.password) {
    return { ok: false as const, reason: "Username or password is incorrect." };
  }

  const token = await createDashboardSessionToken(env, username);
  if (!token) {
    return { ok: false as const, reason: "Dashboard login is not configured." };
  }

  return {
    ok: true as const,
    token,
    username: config.username,
  };
}

export async function verifyDashboardSessionToken(env: Bindings, token: string) {
  const config = getDashboardConfig(env);
  if (!config) {
    return null;
  }

  const [prefix, payloadEncoded, signature] = token.split(".");
  if (prefix !== tokenPrefix || !payloadEncoded || !signature) {
    return null;
  }

  const expectedSignature = await sign(config.sessionSecret, payloadEncoded);
  if (signature !== expectedSignature) {
    return null;
  }

  try {
    const payload = JSON.parse(decoder.decode(base64UrlToBytes(payloadEncoded))) as SessionPayload;
    if (payload.sub !== config.username || payload.exp <= Date.now()) {
      return null;
    }

    return { username: payload.sub };
  } catch {
    return null;
  }
}

function encodeCookieValue(value: string) {
  return encodeURIComponent(value);
}

function decodeCookieValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseCookieHeader(cookieHeader: string | null) {
  const cookies = new Map<string, string>();

  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName || rawValue.length === 0) {
      continue;
    }

    cookies.set(rawName, decodeCookieValue(rawValue.join("=")));
  }

  return cookies;
}

function shouldUseSecureCookies(request: Request) {
  return new URL(request.url).protocol === "https:";
}

export function getDashboardSessionCookie(request: Request) {
  return parseCookieHeader(request.headers.get("cookie")).get(dashboardSessionCookieName) ?? null;
}

export function serializeDashboardSessionCookie(request: Request, token: string) {
  const attributes = [
    `${dashboardSessionCookieName}=${encodeCookieValue(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${sessionLifetimeSeconds}`,
  ];

  if (shouldUseSecureCookies(request)) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function serializeDashboardLogoutCookie(request: Request) {
  const attributes = [
    `${dashboardSessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];

  if (shouldUseSecureCookies(request)) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}
