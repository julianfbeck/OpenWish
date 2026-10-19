import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDashboardSessionToken,
  serializeDashboardSessionCookie,
} from "../src/server/dashboardAuth";
import { createOpenWishOAuthProvider, type OAuthMcpHandler } from "../src/server/oauth";
import { DurableOAuthStorage } from "../src/server/oauth-storage";
import type { Bindings, ProjectRow } from "../src/server/types";
import { MockD1Database } from "./support/mock-d1";
import { MockSendEmail } from "./support/mock-email";
import { MockKV } from "./support/mock-kv";
import { MockR2Bucket } from "./support/mock-r2";

// These fixtures are intentionally synthetic; tests never load local secrets.
const ORIGIN = "https://wishkit.example.test";
const RESOURCE = `${ORIGIN}/mcp`;
const REDIRECT = "https://client.example.test/oauth/callback";
const STUDIO = "ab000000-0000-4000-8000-000000000001";
const ATLAS = "ab000000-0000-4000-8000-000000000002";
const UNKNOWN_PROJECT = "ab000000-0000-4000-8000-000000000099";
const VERIFIER = "test-only-pkce-verifier-with-at-least-43-characters-0123456789";
const STATE = "test-only-callback-state";

type Client = { client_id: string; client_secret?: string };
type TokenResponse = {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
};
type Access = {
  mode: "oauth";
  subject: string;
  projectIds: string[];
  scopes: string[];
};
type Consent = {
  response: Response;
  html: string;
  handle: string;
  cookie: string;
};
type GrantOptions = {
  requestedScopes?: string;
  scopes?: string[];
  projects?: string[];
  persistent?: boolean;
  legacyConsent?: boolean;
};

function project(id: string, slug: string, name: string): ProjectRow {
  return {
    id,
    slug,
    name,
    api_key: `${slug}-test-only-key`,
    admin_token: `${slug}-test-only-admin`,
    watermark_enabled: 0,
    notification_email: null,
    public_form_enabled: 0,
    app_store_url: null,
    app_id: null,
    app_name: null,
    app_icon_url: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function decodeHtml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function attribute(tag: string, name: string) {
  const value = tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1];
  return value === undefined ? undefined : decodeHtml(value);
}

/** Approval and denial leave the consent form through an interstitial page. */
async function continuation(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.has("location")).toBe(false);
  const csp = response.headers.get("content-security-policy") ?? "";
  expect(csp).toContain("form-action 'self';");
  const html = await response.text();
  const target = html.match(/<meta http-equiv="refresh" content="0;url=([^"]+)">/)?.[1];
  expect(target, "Missing continuation refresh").toBeTruthy();
  return new URL(decodeHtml(target!));
}

function inputs(html: string, name: string) {
  return (html.match(/<input\b[^>]*>/gi) ?? []).filter((tag) => attribute(tag, "name") === name);
}

function hidden(html: string, name: string) {
  const value = attribute(inputs(html, name)[0] ?? "", "value");
  expect(value, `Missing ${name} input`).toBeTruthy();
  return value!;
}

function responseCookies(response: Response) {
  const header = response.headers.get("set-cookie") ?? "";
  return header
    .split(/,(?=\s*[^;,\s]+=)/)
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function challenge(verifier = VERIFIER) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

async function fixture(
  projects = [project(STUDIO, "studio", "Studio"), project(ATLAS, "atlas", "Atlas")],
  options: { realMcp?: boolean; handler?: OAuthMcpHandler } = {},
) {
  const storage = new MockKV();
  const db = new MockD1Database({ projects });
  const env: Bindings = {
    DB: db as unknown as D1Database,
    BUGS_BUCKET: new MockR2Bucket() as unknown as R2Bucket,
    RATE_LIMIT_KV: new MockKV() as unknown as KVNamespace,
    NOTIFICATION_EMAIL: new MockSendEmail() as unknown as SendEmail,
    OPENWISH_GLOBAL_API_KEY: "test-only-legacy-mcp-key",
    OPENWISH_DASHBOARD_USERNAME: "test-admin",
    OPENWISH_DASHBOARD_PASSWORD: "test-only-dashboard-password",
    OPENWISH_DASHBOARD_SESSION_SECRET: "test-only-session-signing-secret",
    OPENWISH_MCP_OAUTH_ORIGIN: ORIGIN,
  };
  let verifiedProps: Record<string, unknown> | undefined;
  const provider = createOpenWishOAuthProvider(
    env,
    storage as unknown as KVNamespace,
    options.realMcp ? undefined : options.handler ?? (async (_request, _env, context, access) => {
      verifiedProps = structuredClone((context as unknown as { props: Record<string, unknown> }).props);
      return Response.json(access);
    }),
  );
  const session = await createDashboardSessionToken(env, "test-admin");
  expect(session).toBeTruthy();
  const dashboardCookie = serializeDashboardSessionCookie(new Request(ORIGIN), session!, env).split(";")[0]!;

  const request = (path: string, init?: RequestInit) => provider.fetch(new Request(new URL(path, ORIGIN), init));
  const formRequest = (path: string, values: URLSearchParams, headers: HeadersInit = {}) =>
    request(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...Object.fromEntries(new Headers(headers)) },
      body: values,
    });

  async function register(metadata: Record<string, unknown> = {}) {
    const response = await request("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Synthetic MCP Client",
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        ...metadata,
      }),
    });
    expect(response.status).toBe(201);
    const client = await response.json() as Client;
    expect(client.client_id).toBeTruthy();
    return client;
  }

  async function authorizationUrl(client: Client, params: Record<string, string> = {}) {
    const url = new URL("/oauth/authorize", ORIGIN);
    url.search = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      response_type: "code",
      code_challenge: await challenge(),
      code_challenge_method: "S256",
      resource: RESOURCE,
      scope: "mcp:read",
      state: STATE,
      ...params,
    }).toString();
    return url;
  }

  async function consent(client: Client, params: Record<string, string> = {}): Promise<Consent> {
    const response = await provider.fetch(new Request(await authorizationUrl(client, params), {
      headers: { Cookie: dashboardCookie },
    }));
    expect(response.status).toBe(200);
    const html = await response.text();
    return {
      response,
      html,
      handle: hidden(html, "handle"),
      cookie: `${dashboardCookie}; ${responseCookies(response)}`,
    };
  }

  function approve(page: Consent, options: {
    scopes?: string[];
    projects?: string[];
    origin?: string;
    cookie?: string;
    handle?: string;
    decision?: string;
    extra?: Record<string, string>;
    persistent?: boolean;
  } = {}) {
    const values = new URLSearchParams({
      handle: options.handle ?? page.handle,
      decision: options.decision ?? "approve",
      ...options.extra,
    });
    for (const scope of options.scopes ?? ["mcp:read"]) values.append("scope", scope);
    for (const id of options.projects ?? [STUDIO]) values.append("project", id);
    if (options.persistent) values.append("persistent", "until-revoked");
    return formRequest("/oauth/authorize", values, {
      Origin: options.origin ?? ORIGIN,
      Cookie: options.cookie ?? page.cookie,
    });
  }

  async function legacyPendingConsent(page: Consent) {
    // Model a consent transaction saved by the previous server version, while
    // retaining its actual browser binding and expiry in the synthetic store.
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(page.handle));
    const hashed = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const key = `ui:consent:${hashed}`;
    const stored = storage.store.get(key);
    expect(stored).toBeTruthy();
    const policy = JSON.parse(stored!.value) as Record<string, unknown>;
    delete policy.allowsPersistentRefresh;
    storage.store.set(key, { ...stored!, value: JSON.stringify(policy) });
  }

  async function code(client: Client, options: GrantOptions = {}) {
    const page = await consent(client, { scope: options.requestedScopes ?? "mcp:read" });
    if (options.legacyConsent) await legacyPendingConsent(page);
    const response = await approve(page, options);
    const location = await continuation(response);
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get("state")).toBe(STATE);
    expect(location.searchParams.get("iss")).toBe(ORIGIN);
    expect(location.searchParams.has("error")).toBe(false);
    expect(location.searchParams.get("code")).toBeTruthy();
    return location.searchParams.get("code")!;
  }

  function exchange(client: Client, authorizationCode: string, params: Record<string, string> = {}) {
    return formRequest("/oauth/token", new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      code: authorizationCode,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
      resource: RESOURCE,
      ...params,
    }));
  }

  async function grant(options: GrantOptions = {}) {
    const client = await register();
    const authorizationCode = await code(client, options);
    const response = await exchange(client, authorizationCode);
    expect(response.status).toBe(200);
    const token = await response.json() as TokenResponse;
    expect(token.token_type.toLowerCase()).toBe("bearer");
    expect(token.access_token).toBeTruthy();
    expect(token.expires_in).toBeGreaterThan(0);
    return { client, token };
  }

  function access(token: string) {
    return request("/mcp", { headers: { Authorization: `Bearer ${token}` } });
  }

  function refresh(client: Client, token: string, params: Record<string, string> = {}) {
    return formRequest("/oauth/token", new URLSearchParams({
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: token,
      resource: RESOURCE,
      ...params,
    }));
  }

  function revoke(client: Client, token: string, tokenType = "refresh_token") {
    return formRequest("/oauth/revoke", new URLSearchParams({
      token,
      client_id: client.client_id,
      token_type_hint: tokenType,
    }));
  }

  function basicToken(client: Client, values: URLSearchParams, secret = client.client_secret) {
    expect(secret).toBeTruthy();
    return formRequest("/oauth/token", values, {
      Authorization: `Basic ${btoa(`${encodeURIComponent(client.client_id)}:${encodeURIComponent(secret!)}`)}`,
    });
  }

  return { env, storage, db, provider, request, formRequest, register, authorizationUrl, consent, approve, legacyPendingConsent, code, exchange, grant, access, refresh, revoke, basicToken, dashboardCookie, session,
    get verifiedProps() { return verifiedProps; },
  };
}

async function signedClientFixture() {
  vi.stubGlobal("Cloudflare", { compatibilityFlags: { global_fetch_strictly_public: true } });
  const client: Client = { client_id: "https://signed-client.example.test/client.json" };
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const metadata = {
    client_id: client.client_id,
    client_name: "Synthetic signed MCP client",
    redirect_uris: [REDIRECT],
    token_endpoint_auth_method: "private_key_jwt",
    token_endpoint_auth_signing_alg: "ES256",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    jwks: { keys: [{ ...publicKey, kid: "ephemeral-test-key", alg: "ES256", use: "sig" }] },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
    expect(String(url)).toBe(client.client_id);
    return Response.json(metadata, { headers: { "Cache-Control": "no-store" } });
  }));
  const f = await fixture();

  async function assertion(claims: Record<string, unknown> = {}, key = keys.privateKey) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "ES256", typ: "JWT", kid: "ephemeral-test-key" })));
    const payload = base64Url(new TextEncoder().encode(JSON.stringify({
      iss: client.client_id, sub: client.client_id, aud: `${ORIGIN}/oauth/token`,
      iat: now, exp: now + 120, jti: crypto.randomUUID(), ...claims,
    })));
    const content = `${header}.${payload}`;
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(content));
    return `${content}.${base64Url(new Uint8Array(signature))}`;
  }

  async function signedToken(values: URLSearchParams, claims: Record<string, unknown> = {}, key = keys.privateKey) {
    const form = new URLSearchParams(values);
    form.set("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    form.set("client_assertion", await assertion(claims, key));
    return f.formRequest("/oauth/token", form);
  }

  async function grant() {
    const code = await f.code(client, { requestedScopes: "mcp:read offline_access", scopes: ["mcp:read", "offline_access"] });
    // RFC7523 allows client_id to be inferred from the verified assertion issuer.
    const response = await signedToken(new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: VERIFIER, redirect_uri: REDIRECT, resource: RESOURCE }));
    expect(response.status).toBe(200);
    const token = await response.json() as TokenResponse;
    expect(token.refresh_token).toBeTruthy();
    return token;
  }

  return { ...f, client, assertion, signedToken, signedGrant: grant };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("OpenWish MCP OAuth discovery and dashboard authentication", () => {
  it.each([
    "http://remote.example.test/callback",
    "javascript:alert(1)",
    "https://client.example.test/callback#fragment",
    "https://user:password@client.example.test/callback",
  ])("rejects unsafe registered redirect %s", async (redirect) => {
    const f = await fixture();
    const response = await f.request("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Synthetic client", redirect_uris: [redirect], token_endpoint_auth_method: "none" }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.json()).not.toHaveProperty("client_id");
  });

  it("advertises its canonical MCP audience and authorization server without leaking keys", async () => {
    const f = await fixture();
    const unauthorized = await f.request("/mcp");
    expect(unauthorized.status).toBe(401);
    const authenticate = unauthorized.headers.get("www-authenticate") ?? "";
    const metadataUrl = authenticate.match(/resource_metadata="([^"]+)"/)?.[1];
    expect(metadataUrl).toBe(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`);
    const metadata = await f.request(metadataUrl!);
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      resource: RESOURCE,
      authorization_servers: [ORIGIN],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp:read"],
    });
    const server = await f.request("/.well-known/oauth-authorization-server");
    expect(server.status).toBe(200);
    const details = await server.text();
    expect(JSON.parse(details)).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      revocation_endpoint: `${ORIGIN}/oauth/token`,
      code_challenge_methods_supported: ["S256"],
      scopes_supported: expect.arrayContaining(["mcp:read", "mcp:write", "mcp:admin", "offline_access"]),
    });
    expect(details).not.toContain(f.env.OPENWISH_GLOBAL_API_KEY);
    expect(details).not.toContain(f.env.OPENWISH_DASHBOARD_SESSION_SECRET);
  });

  it("hands anonymous users to login with a local next URL and refuses Bearer dashboard sessions", async () => {
    const f = await fixture();
    const client = await f.register();
    const url = await f.authorizationUrl(client);
    const authentication: HeadersInit[] = [{}, { Authorization: `Bearer ${f.session}` }, { Authorization: `Bearer ${f.env.OPENWISH_GLOBAL_API_KEY}` }];
    for (const headers of authentication) {
      const response = await f.provider.fetch(new Request(url, { headers }));
      expect(response.status).toBe(401);
      const html = await response.text();
      const href = html.match(/href="([^"]*\/login\?next=[^"]+)"/)?.[1];
      expect(href).toBeTruthy();
      const login = new URL(decodeHtml(href!), ORIGIN);
      expect(login.origin).toBe(ORIGIN);
      expect(login.pathname).toBe("/login");
      expect(login.searchParams.get("next")).toBe(`${url.pathname}${url.search}`);
    }
  });

  it("requires browser-bound Secure/HttpOnly consent cookies and explicit project selection", async () => {
    const f = await fixture();
    const page = await f.consent(await f.register(), { scope: "mcp:read mcp:write mcp:admin offline_access" });
    const cookies = page.response.headers.get("set-cookie") ?? "";
    expect(cookies).toContain("__Host-");
    expect(cookies).toContain("Secure");
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("SameSite=Lax");
    expect(page.response.headers.get("cache-control")).toContain("no-store");
    expect(page.response.headers.get("x-frame-options")).toBe("DENY");
    expect(page.html).toContain("client.example.test");
    const scopes = inputs(page.html, "scope");
    expect(scopes.find((tag) => attribute(tag, "value") === "mcp:read")).toMatch(/\bchecked\b/);
    for (const scope of ["mcp:write", "mcp:admin", "offline_access"]) {
      const input = scopes.find((tag) => attribute(tag, "value") === scope);
      expect(input).toBeTruthy();
      expect(input).not.toMatch(/\bchecked\b/);
    }
    expect(inputs(page.html, "project").map((tag) => attribute(tag, "value"))).toEqual(expect.arrayContaining([STUDIO, ATLAS]));
    expect(inputs(page.html, "project").some((tag) => /\bchecked\b/.test(tag))).toBe(false);
  });

  it("preserves own-origin browser consent and rejects missing, opaque and foreign Origins", async () => {
    const f = await fixture();
    const page = await f.consent(await f.register());
    expect(page.response.headers.get("referrer-policy")).toBe("same-origin");
    const values = new URLSearchParams({ handle: page.handle, decision: "approve", scope: "mcp:read", project: STUDIO });
    for (const origin of [undefined, "null", "https://attacker.example.test"]) {
      const headers: Record<string, string> = { Cookie: page.cookie };
      if (origin !== undefined) headers.Origin = origin;
      const rejected = await f.formRequest("/oauth/authorize", values, headers);
      expect(rejected.status).toBe(403);
      expect(rejected.headers.has("location")).toBe(false);
    }
    // Origin failures must leave the pending browser-bound consent usable.
    await continuation(await f.approve(page));
  });

  it("refuses a signed dashboard session for another username without consuming consent", async () => {
    const f = await fixture();
    const client = await f.register();
    const page = await f.consent(client);
    const otherSession = await createDashboardSessionToken(f.env, "synthetic-other-admin");
    expect(otherSession).toBeTruthy();
    const otherCookie = serializeDashboardSessionCookie(new Request(ORIGIN), otherSession!, f.env).split(";")[0]!;
    const authorization = await f.provider.fetch(new Request(await f.authorizationUrl(client), { headers: { Cookie: otherCookie } }));
    expect(authorization.status).toBe(401);
    expect((await f.request("/oauth/grants", { headers: { Cookie: otherCookie } })).status).toBe(401);
    expect((await f.approve(page, { cookie: page.cookie.replace(f.dashboardCookie, otherCookie) })).status).toBe(401);
    expect((await f.request("/mcp", { headers: { Authorization: `Bearer ${otherSession}` } })).status).toBe(401);
    await continuation(await f.approve(page));
  });

  it("offers only requested scopes and escapes hostile client and project metadata", async () => {
    const malicious = '<img src=x onerror="alert(1)">';
    const f = await fixture([project(STUDIO, "studio", malicious)]);
    const client = await f.register({ client_name: malicious });
    const page = await f.consent(client);
    expect(inputs(page.html, "scope").map((tag) => attribute(tag, "value"))).toEqual(["mcp:read"]);
    expect(page.html).not.toContain(malicious);
    expect(page.html).not.toMatch(/<img\b/i);
    expect(decodeHtml(page.html)).toContain(malicious);
  });

  it("supports a verified client metadata document with explicit consent and PKCE without dynamic registration", async () => {
    // Model the configured workerd capability without making a network request.
    vi.stubGlobal("Cloudflare", { compatibilityFlags: { global_fetch_strictly_public: true } });
    const client: Client = { client_id: "https://chatgpt.example.test/client.json" };
    const metadata = {
      client_id: client.client_id,
      client_name: "Synthetic ChatGPT",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
    const fetchMetadata = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(client.client_id);
      return Response.json(metadata, { headers: { "Cache-Control": "no-store" } });
    });
    vi.stubGlobal("fetch", fetchMetadata);
    const f = await fixture();
    const server = await f.request("/.well-known/oauth-authorization-server");
    expect(await server.json()).toMatchObject({ client_id_metadata_document_supported: true });
    const page = await f.consent(client);
    expect(page.html).toContain("chatgpt.example.test");
    expect(page.html).toContain("client.example.test");
    const response = await f.approve(page);
    const code = (await continuation(response)).searchParams.get("code")!;
    const tokenResponse = await f.exchange(client, code);
    expect(tokenResponse.status).toBe(200);
    const token = await tokenResponse.json() as TokenResponse;
    expect((await f.access(token.access_token)).status).toBe(200);
    expect(fetchMetadata).toHaveBeenCalled();
    expect([...f.storage.store.keys()].some((key) => key.startsWith("client:"))).toBe(false);
  });

  it("rejects a client metadata document whose identity differs from its requested URL", async () => {
    vi.stubGlobal("Cloudflare", { compatibilityFlags: { global_fetch_strictly_public: true } });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      client_id: "https://attacker.example.test/other-client.json",
      client_name: "Synthetic impostor",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
    })));
    const f = await fixture();
    const response = await f.provider.fetch(new Request(await f.authorizationUrl({ client_id: "https://chatgpt.example.test/client.json" }), { headers: { Cookie: f.dashboardCookie } }));
    expect(response.status).toBe(400);
    expect(response.headers.has("location")).toBe(false);
    expect([...f.storage.store.keys()].some((key) => key.startsWith("ui:consent:"))).toBe(false);
  });
});

describe("OpenWish MCP OAuth consent and grant isolation", () => {
  it("issues a PKCE code for exactly the selected projects and scopes, without implicit offline access", async () => {
    const f = await fixture();
    const { token } = await f.grant({ requestedScopes: "mcp:read mcp:write", scopes: ["mcp:read"], projects: [ATLAS] });
    expect(token.scope.split(" ")).toEqual(["mcp:read"]);
    expect(token.refresh_token).toBeUndefined();
    const response = await f.access(token.access_token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: "oauth", subject: expect.stringMatching(/^dashboard-[a-f0-9]{64}$/), projectIds: [ATLAS], scopes: ["mcp:read"] });
  });

  it("executes a real MCP tools/call with granted OAuth access and returns only selected projects without keys", async () => {
    const f = await fixture(undefined, { realMcp: true });
    const { token } = await f.grant({ projects: [ATLAS] });
    const response = await f.request("/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", Host: new URL(ORIGIN).hostname },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "openwish_list_projects", arguments: {} } }),
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    const encoded = response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data: "))?.slice(6) : text;
    expect(encoded).toBeTruthy();
    const rpc = JSON.parse(encoded!) as { error?: unknown; result?: { isError?: boolean; structuredContent?: { projects?: Array<{ slug: string }> } } };
    expect(rpc.error).toBeUndefined();
    expect(rpc.result?.isError).not.toBe(true);
    expect(rpc.result?.structuredContent?.projects?.map((entry) => entry.slug)).toEqual(["atlas"]);
    for (const row of f.db.state.projects) {
      expect(encoded).not.toContain(row.api_key);
      expect(encoded).not.toContain(row.admin_token);
    }
  });

  it.each([
    ["no project", { projects: [] }],
    ["unknown project ID", { projects: [UNKNOWN_PROJECT] }],
    ["project slug rather than immutable ID", { projects: ["studio"] }],
    ["unrequested write scope", { scopes: ["mcp:read", "mcp:write"] }],
    ["unrequested offline access", { scopes: ["mcp:read", "offline_access"] }],
    ["unknown scope", { scopes: ["mcp:read", "mcp:everything"] }],
    ["no read permission", { scopes: [] }],
  ])("rejects consent with %s", async (_name, options) => {
    const f = await fixture();
    const page = await f.consent(await f.register());
    const response = await f.approve(page, options);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.has("location")).toBe(false);
  });

  it("rejects a project removed after the consent page was opened", async () => {
    const f = await fixture();
    const page = await f.consent(await f.register());
    f.db.state.projects = f.db.state.projects.filter((entry) => entry.id !== STUDIO);
    expect((await f.approve(page)).status).toBeGreaterThanOrEqual(400);
  });

  it("rejects forged authorization parameters and duplicate consent handles", async () => {
    const f = await fixture();
    const page = await f.consent(await f.register());
    const forgedFields: Record<string, string>[] = [{ redirect_uri: "https://attacker.example.test/callback" }, { resource: "https://another.example.test/mcp" }, { client_id: "other-synthetic-client" }];
    for (const extra of forgedFields) {
      expect((await f.approve(page, { extra })).status).toBeGreaterThanOrEqual(400);
    }
    const duplicate = new URLSearchParams({ handle: page.handle, decision: "approve", scope: "mcp:read", project: STUDIO });
    duplicate.append("handle", "synthetic-forged-handle");
    expect((await f.formRequest("/oauth/authorize", duplicate, { Origin: ORIGIN, Cookie: page.cookie })).status).toBeGreaterThanOrEqual(400);
    const approved = await f.approve(page);
    expect((await continuation(approved)).origin).toBe(new URL(REDIRECT).origin);
  });

  it.each([
    ["cross-origin POST", { origin: "https://attacker.example.test" }],
    ["missing browser binding", { cookie: "" }],
    ["dashboard cookie without consent binding", { dashboardOnly: true }],
    ["forged handle", { handle: "synthetic-forged-handle" }],
  ])("rejects %s", async (_name, options) => {
    const f = await fixture();
    const page = await f.consent(await f.register());
    const response = await f.approve(page, { ...options, ...("dashboardOnly" in options && options.dashboardOnly ? { cookie: f.dashboardCookie } : {}) });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.has("location")).toBe(false);
  });

  it("leaves the consent form through a page so callback redirects are not blocked by form-action", async () => {
    // Regression: www.cursor.com's callback 308-redirects to cursor.com. A 302
    // from the form POST put that hop under the consent page's form-action CSP,
    // Chromium blocked it silently, and the second click failed as already used.
    const f = await fixture();
    const page = await f.consent(await f.register());
    expect(page.response.headers.get("content-security-policy")).toContain("form-action 'self';");
    expect(page.response.headers.get("content-security-policy")).not.toContain(new URL(REDIRECT).origin);

    const approved = await f.approve(page);
    const html = await approved.clone().text();
    const target = await continuation(approved);
    expect(`${target.origin}${target.pathname}`).toBe(REDIRECT);
    expect(target.searchParams.get("code")).toBeTruthy();
    expect(html).toContain(`continue to ${new URL(REDIRECT).host}`);
    expect(attribute(html.match(/<a\b[^>]*>/i)![0], "href")).toBe(target.href);
  });

  it("explains why a consent submission was rejected and logs the reason", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const f = await fixture();
    const page = await f.consent(await f.register());

    const unbound = await f.approve(page, { cookie: f.dashboardCookie });
    expect(unbound.status).toBe(400);
    expect(await unbound.text()).toContain("This authorization was not started in this browser");

    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 11 * 60 * 1000);
    const expired = await f.approve(page);
    expect(expired.status).toBe(400);
    expect(await expired.text()).toContain("This consent page expired after 10 minutes");

    const logged = warn.mock.calls.map((call) => String(call[1]));
    expect(logged.some((entry) => entry.includes("\"code\":\"invalid_request\""))).toBe(true);
    expect(logged.some((entry) => entry.includes("policy-missing"))).toBe(true);
    expect(logged.join("\n")).not.toContain(page.handle);
    vi.restoreAllMocks();
  });

  it("rejects missing Origin and a consent handle replay, including simultaneous submissions", async () => {
    const f = await fixture();
    const page = await f.consent(await f.register());
    const noOrigin = await f.formRequest("/oauth/authorize", new URLSearchParams({ handle: page.handle, decision: "approve", scope: "mcp:read", project: STUDIO }), { Cookie: page.cookie });
    expect(noOrigin.status).toBeGreaterThanOrEqual(400);
    const responses = await Promise.all([f.approve(page), f.approve(page)]);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status >= 400)).toHaveLength(1);
    expect((await f.approve(page)).status).toBeGreaterThanOrEqual(400);
  });

  it("expires browser consent without granting access and preserves state when consent is denied", async () => {
    const f = await fixture();
    const client = await f.register();
    const page = await f.consent(client);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 11 * 60 * 1000);
    expect((await f.approve(page)).status).toBeGreaterThanOrEqual(400);
    vi.restoreAllMocks();
    const denied = await f.approve(await f.consent(client), { decision: "deny" });
    const location = await continuation(denied);
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe(STATE);
    expect(location.searchParams.get("iss")).toBe(ORIGIN);
    expect(location.searchParams.has("code")).toBe(false);
  });

  it("never redirects an invalid client or unregistered callback", async () => {
    const f = await fixture();
    const client = await f.register();
    const invalidRequests: Record<string, string>[] = [{ client_id: "unknown-synthetic-client" }, { redirect_uri: "https://attacker.example.test/callback" }, { redirect_uri: `${REDIRECT}?unexpected=1` }];
    for (const params of invalidRequests) {
      const response = await f.provider.fetch(new Request(await f.authorizationUrl(client, params), { headers: { Cookie: f.dashboardCookie } }));
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.headers.has("location")).toBe(false);
    }
  });

  it("rejects authorization resource confusion, PKCE downgrade, and duplicate parameters", async () => {
    const f = await fixture();
    const client = await f.register();
    const invalidRequests: Record<string, string>[] = [{ resource: "https://another.example.test/mcp" }, { code_challenge_method: "plain" }, { code_challenge: "" }];
    for (const params of invalidRequests) {
      const response = await f.provider.fetch(new Request(await f.authorizationUrl(client, params), { headers: { Cookie: f.dashboardCookie } }));
      if (response.status === 302) {
        const callback = new URL(response.headers.get("location")!);
        expect(callback.searchParams.has("error")).toBe(true);
        expect(callback.searchParams.has("code")).toBe(false);
      } else {
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    }
    const url = await f.authorizationUrl(client);
    url.searchParams.append("redirect_uri", "https://attacker.example.test/callback");
    const repeated = await f.provider.fetch(new Request(url, { headers: { Cookie: f.dashboardCookie } }));
    expect(repeated.status).toBeGreaterThanOrEqual(400);
    expect(repeated.headers.has("location")).toBe(false);
  });

  it("requires well-formed S256 PKCE for confidential clients as well as public clients", async () => {
    const f = await fixture();
    const client = await f.register({ token_endpoint_auth_method: "client_secret_post" });
    expect(client.client_secret).toBeTruthy();
    const invalidRequests: Record<string, string>[] = [
      { code_challenge_method: "plain" },
      { code_challenge_method: "" },
      { code_challenge: "" },
      { code_challenge: "a".repeat(42) },
      { code_challenge: "a".repeat(44) },
      { code_challenge: `${"a".repeat(42)}+` },
    ];
    for (const params of invalidRequests) {
      const response = await f.provider.fetch(new Request(await f.authorizationUrl(client, params), { headers: { Cookie: f.dashboardCookie } }));
      expect(response.status).toBe(400);
      expect(response.headers.has("location")).toBe(false);
    }
    const authorizationCode = await f.code(client);
    const valid = await f.exchange(client, authorizationCode, { client_secret: client.client_secret! });
    expect(valid.status).toBe(200);
  });

  it("requires an explicit exact canonical resource on authorization requests", async () => {
    const f = await fixture();
    const client = await f.register();
    for (const resource of [undefined, "", `${RESOURCE}/`, `${RESOURCE}#fragment`, `${ORIGIN}/other`]) {
      const url = await f.authorizationUrl(client);
      if (resource === undefined) url.searchParams.delete("resource");
      else url.searchParams.set("resource", resource);
      const response = await f.provider.fetch(new Request(url, { headers: { Cookie: f.dashboardCookie } }));
      expect(response.status).toBe(400);
      expect(response.headers.has("location")).toBe(false);
    }
    expect((await f.consent(client)).response.status).toBe(200);
  });
});

describe("OpenWish MCP OAuth token lifecycle", () => {
  it.each([
    ["wrong verifier", { code_verifier: `${VERIFIER}-wrong` }],
    ["missing verifier", { code_verifier: "" }],
    ["wrong resource", { resource: "https://another.example.test/mcp" }],
    ["wrong redirect", { redirect_uri: "https://attacker.example.test/callback" }],
    ["wrong client", { client_id: "unknown-synthetic-client" }],
  ])("rejects token exchange with %s", async (_name, params) => {
    const f = await fixture();
    const client = await f.register();
    const response = await f.exchange(client, await f.code(client), params);
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBeTruthy();
    expect(body.access_token).toBeUndefined();
  });

  it("allows only one simultaneous exchange of an authorization code", async () => {
    const f = await fixture();
    const client = await f.register();
    const code = await f.code(client);
    const responses = await Promise.all([f.exchange(client, code), f.exchange(client, code)]);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status >= 400)).toHaveLength(1);
    // RFC6749 replay detection revokes the issued grant too; a raced winner
    // must not leave an independently usable token after replay was detected.
    const winner = await responses.find((response) => response.status === 200)!.json() as TokenResponse;
    expect((await f.access(winner.access_token)).status).toBe(401);
    expect((await f.exchange(client, code)).status).toBeGreaterThanOrEqual(400);
  });

  it("allows a legitimate retry after failed PKCE and rejects an expired unconsumed code", async () => {
    const f = await fixture();
    const client = await f.register();
    const code = await f.code(client);
    expect((await f.exchange(client, code, { code_verifier: `${VERIFIER}-wrong` })).status).toBe(400);
    const valid = await f.exchange(client, code);
    expect(valid.status).toBe(200);
    expect(valid.headers.get("cache-control")).toContain("no-store");
    const expired = await f.code(client);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 601_000);
    expect((await f.exchange(client, expired)).status).toBe(400);
  });

  it.each([
    ["short", "a".repeat(42)],
    ["too long", "a".repeat(129)],
    ["illegal character", `${"a".repeat(42)}+`],
  ])("rejects a %s PKCE verifier without consuming the legitimate code", async (_name, verifier) => {
    const f = await fixture();
    const client = await f.register();
    const code = await f.code(client);
    const invalid = await f.exchange(client, code, { code_verifier: verifier });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "invalid_request" });
    expect((await f.exchange(client, code)).status).toBe(200);
  });

  it("rejects duplicate token resources and JSON token bodies before issuing access", async () => {
    const f = await fixture();
    const client = await f.register();
    const code = await f.code(client);
    const values = new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, code, code_verifier: VERIFIER, redirect_uri: REDIRECT, resource: RESOURCE });
    values.append("resource", "https://another.example.test/mcp");
    const duplicated = await f.formRequest("/oauth/token", values);
    expect(duplicated.status).toBe(400);
    expect(await duplicated.json()).toMatchObject({ error: "invalid_request" });
    const json = await f.request("/oauth/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grant_type: "authorization_code", client_id: client.client_id, code, code_verifier: VERIFIER }) });
    expect(json.status).toBe(400);
    expect((await f.exchange(client, code)).status).toBe(200);
  });

  it("rejects expired access tokens and malformed OAuth tokens", async () => {
    const f = await fixture();
    const { token } = await f.grant();
    expect((await f.access(token.access_token)).status).toBe(200);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + (token.expires_in + 1) * 1000);
    expect((await f.access(token.access_token)).status).toBe(401);
    expect((await f.access(`${token.access_token}-tampered`)).status).toBe(401);
    expect((await f.access("synthetic-invalid-token")).status).toBe(401);
  });

  it("rotates requested offline refresh tokens and preserves selected scopes and audience", async () => {
    const f = await fixture();
    const { client, token } = await f.grant({ requestedScopes: "mcp:read mcp:write offline_access", scopes: ["mcp:read", "offline_access"], projects: [ATLAS] });
    expect(token.refresh_token).toBeTruthy();
    const renewed = await f.refresh(client, token.refresh_token!);
    expect(renewed.status).toBe(200);
    const next = await renewed.json() as TokenResponse;
    expect(next.refresh_token).toBeTruthy();
    expect(next.refresh_token).not.toBe(token.refresh_token);
    expect(next.access_token).not.toBe(token.access_token);
    const access = await f.access(next.access_token);
    expect(access.status).toBe(200);
    expect(await access.json()).toMatchObject({ mode: "oauth", projectIds: [ATLAS], scopes: ["mcp:read", "offline_access"] } satisfies Partial<Access>);
    const wrongAudience = await f.refresh(client, next.refresh_token!, { resource: "https://another.example.test/mcp" });
    expect(wrongAudience.status).toBeGreaterThanOrEqual(400);
    const escalation = await f.refresh(client, next.refresh_token!, { scope: "mcp:read mcp:write offline_access" });
    expect(escalation.status).toBe(200);
    const downscoped = await escalation.json() as TokenResponse;
    expect(downscoped.scope.split(" ")).toEqual(["mcp:read", "offline_access"]);
    const replay = await f.refresh(client, next.refresh_token!);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
    expect((await f.access(downscoped.access_token)).status).toBe(401);
    expect((await f.refresh(client, downscoped.refresh_token!)).status).toBe(400);
  });

  it("rejects the first refresh-token replay and revokes all replacement access and refresh tokens", async () => {
    const f = await fixture();
    const { client, token } = await f.grant({ requestedScopes: "mcp:read offline_access", scopes: ["mcp:read", "offline_access"] });
    const renewed = await f.refresh(client, token.refresh_token!);
    expect(renewed.status).toBe(200);
    const next = await renewed.json() as TokenResponse;
    expect((await f.access(next.access_token)).status).toBe(200);
    const replay = await f.refresh(client, token.refresh_token!);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
    expect((await f.access(token.access_token)).status).toBe(401);
    expect((await f.access(next.access_token)).status).toBe(401);
    expect((await f.refresh(client, next.refresh_token!)).status).toBe(400);
  });

  it("revokes the active grant on a consumed refresh-token replay after two later rotations", async () => {
    const f = await fixture();
    const { client, token } = await f.grant({ requestedScopes: "mcp:read offline_access", scopes: ["mcp:read", "offline_access"] });
    const first = await f.refresh(client, token.refresh_token!);
    expect(first.status).toBe(200);
    const r1 = await first.json() as TokenResponse;
    const second = await f.refresh(client, r1.refresh_token!);
    expect(second.status).toBe(200);
    const r2 = await second.json() as TokenResponse;
    expect((await f.access(r2.access_token)).status).toBe(200);
    const replay = await f.refresh(client, token.refresh_token!);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
    expect((await f.access(r2.access_token)).status).toBe(401);
    expect((await f.refresh(client, r2.refresh_token!)).status).toBe(400);
  });

  it("authenticates a confidential Basic client before a consumed token replay can revoke its grant", async () => {
    const f = await fixture();
    const client = await f.register({ token_endpoint_auth_method: "client_secret_basic" });
    const code = await f.code(client, { requestedScopes: "mcp:read offline_access", scopes: ["mcp:read", "offline_access"] });
    const exchange = await f.basicToken(client, new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: VERIFIER, resource: RESOURCE }));
    expect(exchange.status).toBe(200);
    const token = await exchange.json() as TokenResponse;
    const initialValues = new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refresh_token!, resource: RESOURCE });
    const first = await f.basicToken(client, initialValues);
    expect(first.status).toBe(200);
    const r1 = await first.json() as TokenResponse;
    const second = await f.basicToken(client, new URLSearchParams({ grant_type: "refresh_token", refresh_token: r1.refresh_token!, resource: RESOURCE }));
    expect(second.status).toBe(200);
    const r2 = await second.json() as TokenResponse;
    const wrongSecret = await f.basicToken(client, initialValues, "synthetic-wrong-client-secret");
    expect(wrongSecret.status).toBe(401);
    expect((await f.access(r2.access_token)).status).toBe(200);
    const otherClient = await f.register({ token_endpoint_auth_method: "client_secret_basic" });
    const otherAuthenticated = await f.basicToken(otherClient, initialValues);
    expect(otherAuthenticated.status).toBeGreaterThanOrEqual(400);
    expect((await f.access(r2.access_token)).status).toBe(200);
    const ambiguousClient = new URLSearchParams(initialValues);
    ambiguousClient.set("client_id", client.client_id);
    expect((await f.basicToken(client, ambiguousClient)).status).toBeGreaterThanOrEqual(400);
    expect((await f.access(r2.access_token)).status).toBe(200);
    // OAuth Basic credentials use application/x-www-form-urlencoded before
    // base64; even safe client-ID characters may be percent-encoded.
    const encodedClientId = [...client.client_id].map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`).join("");
    const validReplay = await f.formRequest("/oauth/token", initialValues, {
      Authorization: `Basic ${btoa(`${encodedClientId}:${encodeURIComponent(client.client_secret!)}`)}`,
    });
    expect(validReplay.status).toBe(400);
    expect(await validReplay.json()).toMatchObject({ error: "invalid_grant" });
    expect((await f.access(r2.access_token)).status).toBe(401);
    expect((await f.basicToken(client, new URLSearchParams({ grant_type: "refresh_token", refresh_token: r2.refresh_token!, resource: RESOURCE }))).status).toBe(400);
  });

  it("revokes a historical refresh replay authenticated by private_key_jwt when client_id is omitted", async () => {
    const f = await signedClientFixture();
    const token = await f.signedGrant();
    const old = new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refresh_token!, resource: RESOURCE });
    const first = await f.signedToken(old);
    expect(first.status).toBe(200);
    const r1 = await first.json() as TokenResponse;
    const second = await f.signedToken(new URLSearchParams({ grant_type: "refresh_token", refresh_token: r1.refresh_token!, resource: RESOURCE }));
    expect(second.status).toBe(200);
    const r2 = await second.json() as TokenResponse;
    expect((await f.access(r2.access_token)).status).toBe(200);
    const replay = await f.signedToken(old);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
    expect((await f.access(r2.access_token)).status).toBe(401);
    expect((await f.signedToken(new URLSearchParams({ grant_type: "refresh_token", refresh_token: r2.refresh_token!, resource: RESOURCE }))).status).toBe(400);
  });

  it("does not let assertions with the wrong issuer, subject, audience or signing key revoke a historical grant", async () => {
    const f = await signedClientFixture();
    const token = await f.signedGrant();
    const old = new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refresh_token!, resource: RESOURCE });
    const first = await f.signedToken(old);
    expect(first.status).toBe(200);
    const r1 = await first.json() as TokenResponse;
    const second = await f.signedToken(new URLSearchParams({ grant_type: "refresh_token", refresh_token: r1.refresh_token!, resource: RESOURCE }));
    expect(second.status).toBe(200);
    const r2 = await second.json() as TokenResponse;
    const invalidClaims: Record<string, unknown>[] = [
      { iss: "https://impostor.example.test/client.json" },
      { sub: "https://impostor.example.test/client.json" },
      { aud: "https://another-issuer.example.test/oauth/token" },
    ];
    for (const claims of invalidClaims) {
      const invalid = await f.signedToken(old, claims);
      expect(invalid.status).toBe(401);
      expect(await invalid.json()).toMatchObject({ error: "invalid_client" });
      expect((await f.access(r2.access_token)).status).toBe(200);
    }
    const impostorKeys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const badSignature = await f.signedToken(old, {}, impostorKeys.privateKey);
    expect(badSignature.status).toBe(401);
    expect((await f.access(r2.access_token)).status).toBe(200);
    const validReplay = await f.signedToken(old);
    expect(validReplay.status).toBe(400);
    expect((await f.access(r2.access_token)).status).toBe(401);
  });

  it("does not let wrong clients, wrong resources or duplicate consumed-token parameters revoke an active grant", async () => {
    const f = await fixture();
    const { client, token } = await f.grant({ requestedScopes: "mcp:read offline_access", scopes: ["mcp:read", "offline_access"] });
    const first = await f.refresh(client, token.refresh_token!);
    expect(first.status).toBe(200);
    const next = await first.json() as TokenResponse;
    const other = await f.register();
    expect((await f.refresh(other, token.refresh_token!)).status).toBeGreaterThanOrEqual(400);
    expect((await f.access(next.access_token)).status).toBe(200);
    expect((await f.refresh(client, token.refresh_token!, { resource: "https://another.example.test/mcp" })).status).toBe(400);
    expect((await f.access(next.access_token)).status).toBe(200);
    for (const field of ["refresh_token", "client_id", "resource", "grant_type"]) {
      const duplicated = new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: token.refresh_token!, resource: RESOURCE });
      duplicated.append(field, duplicated.get(field)!);
      expect((await f.formRequest("/oauth/token", duplicated)).status).toBeGreaterThanOrEqual(400);
      expect((await f.access(next.access_token)).status).toBe(200);
    }
    expect((await f.refresh(client, next.refresh_token!)).status).toBe(200);
  });

  it("serializes simultaneous use of the same refresh token and revokes the raced grant", async () => {
    const f = await fixture();
    const { client, token } = await f.grant({ requestedScopes: "mcp:read offline_access", scopes: ["mcp:read", "offline_access"] });
    const responses = await Promise.all([f.refresh(client, token.refresh_token!), f.refresh(client, token.refresh_token!)]);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 400)).toHaveLength(1);
    const next = await responses.find((response) => response.status === 200)!.json() as TokenResponse;
    expect((await f.access(next.access_token)).status).toBe(401);
    expect((await f.refresh(client, next.refresh_token!)).status).toBe(400);
  });

  it("preserves refresh replay protection after the OAuth coordinator is recreated", async () => {
    const f = await fixture();
    const { client, token } = await f.grant({ requestedScopes: "mcp:read offline_access", scopes: ["mcp:read", "offline_access"] });
    const renewed = await f.refresh(client, token.refresh_token!);
    expect(renewed.status).toBe(200);
    const next = await renewed.json() as TokenResponse;
    const restarted = createOpenWishOAuthProvider(f.env, f.storage as unknown as KVNamespace, async (_request, _env, _context, access) => Response.json(access));
    const replay = await restarted.fetch(new Request(`${ORIGIN}/oauth/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: token.refresh_token!, resource: RESOURCE }),
    }));
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
    expect((await restarted.fetch(new Request(RESOURCE, { headers: { Authorization: `Bearer ${next.access_token}` } }))).status).toBe(401);
  });

  it("requires a supplied exact resource during code exchange and refresh without consuming valid credentials", async () => {
    const f = await fixture();
    const client = await f.register();
    const code = await f.code(client, { requestedScopes: "mcp:read offline_access", scopes: ["mcp:read", "offline_access"] });
    for (const resource of [undefined, "", `${RESOURCE}/`, `${RESOURCE}#fragment`, `${ORIGIN}/other`]) {
      const values = new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, code, code_verifier: VERIFIER, redirect_uri: REDIRECT });
      if (resource !== undefined) values.set("resource", resource);
      const rejected = await f.formRequest("/oauth/token", values);
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).not.toHaveProperty("access_token");
    }
    const valid = await f.exchange(client, code);
    expect(valid.status).toBe(200);
    const token = await valid.json() as TokenResponse;
    for (const resource of [undefined, "", `${RESOURCE}/`, `${RESOURCE}#fragment`, `${ORIGIN}/other`]) {
      const values = new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: token.refresh_token! });
      if (resource !== undefined) values.set("resource", resource);
      const rejected = await f.formRequest("/oauth/token", values);
      expect(rejected.status).toBe(400);
      expect((await f.access(token.access_token)).status).toBe(200);
    }
    expect((await f.refresh(client, token.refresh_token!)).status).toBe(200);
  });

  it("revokes an offline grant through RFC7009 and rejects subsequent access and refresh", async () => {
    const f = await fixture();
    const { client, token } = await f.grant({ requestedScopes: "mcp:read offline_access", scopes: ["mcp:read", "offline_access"] });
    expect((await f.revoke(client, token.refresh_token!)).status).toBe(200);
    expect((await f.access(token.access_token)).status).toBe(401);
    expect((await f.refresh(client, token.refresh_token!)).status).toBeGreaterThanOrEqual(400);
    expect((await f.revoke(client, "synthetic-unknown-token")).status).toBe(200);
  });

  it("does not let another client revoke or refresh a grant it does not own", async () => {
    const f = await fixture();
    const { client, token } = await f.grant({ requestedScopes: "mcp:read offline_access", scopes: ["mcp:read", "offline_access"] });
    const other = await f.register();
    expect((await f.revoke(other, token.refresh_token!)).status).toBe(200);
    expect((await f.refresh(other, token.refresh_token!)).status).toBeGreaterThanOrEqual(400);
    expect((await f.access(token.access_token)).status).toBe(200);
    expect([...f.storage.store.keys()].some((key) => key.startsWith("ui:used-refresh:"))).toBe(false);
    expect((await f.refresh(client, token.refresh_token!, { resource: "https://another.example.test/mcp" })).status).toBeGreaterThanOrEqual(400);
    expect([...f.storage.store.keys()].some((key) => key.startsWith("ui:used-refresh:"))).toBe(false);
    expect((await f.refresh(client, token.refresh_token!)).status).toBe(200);
  });

  it("supports individual access-token revocation while retaining a consented refresh grant", async () => {
    const f = await fixture();
    const { client, token } = await f.grant({ requestedScopes: "mcp:read offline_access", scopes: ["mcp:read", "offline_access"] });
    expect((await f.revoke(client, token.access_token, "access_token")).status).toBe(200);
    expect((await f.access(token.access_token)).status).toBe(401);
    const renewed = await f.refresh(client, token.refresh_token!);
    expect(renewed.status).toBe(200);
    const next = await renewed.json() as TokenResponse;
    expect((await f.access(next.access_token)).status).toBe(200);
  });

  it("retains the original finite lifetime of a legacy offline grant across refreshes", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const f = await fixture();
    const { client, token } = await f.grant({ requestedScopes: "mcp:read offline_access", scopes: ["mcp:read", "offline_access"], legacyConsent: true });
    const [key, stored] = [...f.storage.store.entries()].find(([key]) => key.startsWith("grant:"))!;
    const initialGrant = JSON.parse(stored.value);
    expect(initialGrant.expiresAt).toBe(Math.floor(now / 1000) + 30 * 24 * 60 * 60);
    expect(initialGrant.metadata).not.toHaveProperty("refreshLifetime");
    expect(stored.expiresAtMs).toBe(initialGrant.expiresAt * 1000);
    expect((await f.access(token.access_token)).status).toBe(200);
    expect(f.verifiedProps).not.toHaveProperty("refreshLifetime");
    clock.mockReturnValue(now + 15 * 24 * 60 * 60 * 1000);
    const renewed = await f.refresh(client, token.refresh_token!);
    expect(renewed.status).toBe(200);
    const next = await renewed.json() as TokenResponse;
    expect(next.expires_in).toBe(900);
    expect(JSON.parse(f.storage.store.get(key)!.value).expiresAt).toBe(initialGrant.expiresAt);
    expect(f.storage.store.get(key)!.expiresAtMs).toBe(initialGrant.expiresAt * 1000);
    expect((await f.access(next.access_token)).status).toBe(200);
    expect(f.verifiedProps).not.toHaveProperty("refreshLifetime");
    clock.mockReturnValue(now + 31 * 24 * 60 * 60 * 1000);
    const expired = await f.refresh(client, next.refresh_token!);
    expect(expired.status).toBe(400);
    expect(await expired.json()).toMatchObject({ error: "invalid_grant" });
    expect((await f.access(token.access_token)).status).toBe(401);
    expect((await f.access(next.access_token)).status).toBe(401);
  });

  it("requires authenticated, origin-checked CSRF consent to revoke grants in the dashboard", async () => {
    const f = await fixture();
    const { token } = await f.grant({ requestedScopes: "mcp:read offline_access", scopes: ["mcp:read", "offline_access"] });
    const anonymous = await f.request("/oauth/grants");
    expect([302, 401]).toContain(anonymous.status);
    const page = await f.request("/oauth/grants", { headers: { Cookie: f.dashboardCookie } });
    expect(page.status).toBe(200);
    expect(page.headers.get("referrer-policy")).toBe("same-origin");
    const html = await page.text();
    expect(html).not.toContain(token.access_token);
    expect(html).not.toContain(token.refresh_token);
    const csrf = hidden(html, "csrf");
    const grantId = hidden(html, "grantId");
    const cookie = `${f.dashboardCookie}; ${responseCookies(page)}`;
    const values = new URLSearchParams({ csrf, grantId });
    for (const origin of [undefined, "null", "https://attacker.example.test"]) {
      const headers: Record<string, string> = { Cookie: cookie };
      if (origin !== undefined) headers.Origin = origin;
      const rejected = await f.formRequest("/oauth/grants", values, headers);
      expect(rejected.status).toBe(403);
      expect(rejected.headers.has("location")).toBe(false);
      expect((await f.access(token.access_token)).status).toBe(200);
    }
    const badCsrf = await f.formRequest("/oauth/grants", new URLSearchParams({ csrf: "synthetic-forged-csrf", grantId }), { Origin: ORIGIN, Cookie: cookie });
    expect(badCsrf.status).toBeGreaterThanOrEqual(400);
    expect((await f.access(token.access_token)).status).toBe(200);
    const revoked = await f.formRequest("/oauth/grants", values, { Origin: ORIGIN, Cookie: cookie });
    expect([200, 302, 303]).toContain(revoked.status);
    expect((await f.access(token.access_token)).status).toBe(401);
    expect((await f.formRequest("/oauth/grants", values, { Origin: ORIGIN, Cookie: cookie })).status).toBeGreaterThanOrEqual(400);
  });

  it("serializes concurrent grant revocation and access so later requests cannot reuse revoked access", async () => {
    let resolveStarted!: () => void;
    let finishBody!: () => void;
    const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
    const gate = new Promise<void>((resolve) => { finishBody = resolve; });
    const f = await fixture(undefined, { handler: async (_request, _env, _context, access) => {
      resolveStarted();
      return new Response(new ReadableStream({
        async start(controller) {
          await gate;
          controller.enqueue(new TextEncoder().encode(JSON.stringify(access)));
          controller.close();
        },
      }));
    } });
    const { client, token } = await f.grant({ requestedScopes: "mcp:read offline_access", scopes: ["mcp:read", "offline_access"] });
    const inFlight = f.access(token.access_token);
    await started;
    let revocationComplete = false;
    const revocation = f.revoke(client, token.refresh_token!).then((response) => { revocationComplete = true; return response; });
    // Permit body preparation to finish while the response is still streaming.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(revocationComplete).toBe(false);
    finishBody();
    const access = await inFlight;
    expect(access.status).toBe(200);
    const revoked = await revocation;
    expect(revoked.status).toBe(200);
    expect((await f.access(token.access_token)).status).toBe(401);
  });
});

describe("explicit persistent OAuth connections", () => {
  it("offers an unchecked persistence choice for read-only consent and issues no refresh token by default", async () => {
    const f = await fixture();
    const client = await f.register();
    const page = await f.consent(client);
    expect(inputs(page.html, "scope").map((tag) => attribute(tag, "value"))).toEqual(["mcp:read"]);
    const persistent = inputs(page.html, "persistent");
    expect(persistent).toHaveLength(1);
    expect(attribute(persistent[0]!, "type")).toBe("checkbox");
    expect(attribute(persistent[0]!, "value")).toBe("until-revoked");
    expect(persistent[0]).not.toMatch(/\bchecked\b/);
    expect(decodeHtml(page.html)).toContain("until I revoke it");
    const approved = await f.approve(page);
    const response = await f.exchange(client, (await continuation(approved)).searchParams.get("code")!);
    expect(response.status).toBe(200);
    const token = await response.json() as TokenResponse;
    expect(token.scope).toBe("mcp:read");
    expect(token.expires_in).toBe(900);
    expect(token.refresh_token).toBeUndefined();
    expect((await f.access(token.access_token)).status).toBe(200);
    expect(f.verifiedProps).not.toHaveProperty("refreshLifetime");
  });

  it("issues a persistent read-only grant without silently adding offline or wider scopes", async () => {
    const f = await fixture();
    const { token } = await f.grant({ persistent: true, projects: [ATLAS] });
    expect(token.refresh_token).toBeTruthy();
    expect(token.scope).toBe("mcp:read");
    expect(token.expires_in).toBe(900);
    const response = await f.access(token.access_token);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ projectIds: [ATLAS], scopes: ["mcp:read"] });
    expect(f.verifiedProps).toMatchObject({ projectIds: [ATLAS], scopes: ["mcp:read"], refreshLifetime: "until-revoked" });
    const stored = [...f.storage.store.entries()].find(([key]) => key.startsWith("grant:"))![1];
    expect(JSON.parse(stored.value)).toMatchObject({ scope: ["mcp:read"], metadata: { refreshLifetime: "until-revoked", projectIds: [ATLAS] } });
    expect(JSON.parse(stored.value)).not.toHaveProperty("expiresAt");
    expect(stored.expiresAtMs).toBeNull();
    const page = await f.request("/oauth/grants", { headers: { Cookie: f.dashboardCookie } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(decodeHtml(html)).toContain("until revoked");
    expect(html).toContain("15 minutes");
    expect(html).not.toContain(token.access_token);
    expect(html).not.toContain(token.refresh_token);
  });

  it("keeps persistent renewal subject to the independent 15-minute access-token expiry", async () => {
    const f = await fixture();
    const { client, token } = await f.grant({ persistent: true });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 901_000);
    expect((await f.access(token.access_token)).status).toBe(401);
    const refreshed = await f.refresh(client, token.refresh_token!);
    expect(refreshed.status).toBe(200);
    const next = await refreshed.json() as TokenResponse;
    expect(next.expires_in).toBe(900);
    expect((await f.access(next.access_token)).status).toBe(200);
  });

  it("only treats requested offline access as persistent when the user approves that unchecked permission", async () => {
    const f = await fixture();
    const client = await f.register();
    const page = await f.consent(client, { scope: "mcp:read offline_access" });
    const offline = inputs(page.html, "scope").find((tag) => attribute(tag, "value") === "offline_access");
    expect(offline).toBeTruthy();
    expect(offline).not.toMatch(/\bchecked\b/);
    expect(inputs(page.html, "persistent")).toHaveLength(0);
    expect(decodeHtml(page.html)).toContain("until I revoke it");
    const declinedOffline = await f.grant({ requestedScopes: "mcp:read offline_access", scopes: ["mcp:read"] });
    expect(declinedOffline.token.refresh_token).toBeUndefined();
    expect(declinedOffline.token.scope).toBe("mcp:read");
    const approvedOffline = await f.grant({ requestedScopes: "mcp:read offline_access", scopes: ["mcp:read", "offline_access"] });
    expect(approvedOffline.token.refresh_token).toBeTruthy();
    expect(approvedOffline.token.scope).toBe("mcp:read offline_access");
    expect((await f.access(approvedOffline.token.access_token)).status).toBe(200);
    expect(f.verifiedProps?.refreshLifetime).toBe("until-revoked");
  });

  it.each([["unknown value", ["forever"]], ["empty value", [""]], ["duplicate choice", ["until-revoked", "until-revoked"]]])(
    "rejects %s in persistence consent without consuming the pending authorization",
    async (_name, choices) => {
      const f = await fixture();
      const page = await f.consent(await f.register());
      const values = new URLSearchParams({ handle: page.handle, decision: "approve", scope: "mcp:read", project: STUDIO });
      for (const choice of choices) values.append("persistent", choice);
      const rejected = await f.formRequest("/oauth/authorize", values, { Origin: ORIGIN, Cookie: page.cookie });
      expect(rejected.status).toBeGreaterThanOrEqual(400);
      expect(rejected.headers.has("location")).toBe(false);
      await continuation(await f.approve(page, { persistent: true }));
    },
  );

  it("does not allow old pending consent to opt into persistence or silently gain it", async () => {
    const f = await fixture();
    const client = await f.register();
    const page = await f.consent(client);
    await f.legacyPendingConsent(page);
    expect((await f.approve(page, { persistent: true })).status).toBeGreaterThanOrEqual(400);
    const approved = await f.approve(page);
    const response = await f.exchange(client, (await continuation(approved)).searchParams.get("code")!);
    expect(response.status).toBe(200);
    const token = await response.json() as TokenResponse;
    expect(token.refresh_token).toBeUndefined();
    expect((await f.access(token.access_token)).status).toBe(200);
    expect(f.verifiedProps).not.toHaveProperty("refreshLifetime");
  });

  it("retains an existing finite grant deadline even when display metadata alone says until revoked", async () => {
    const f = await fixture();
    const { client, token } = await f.grant({ requestedScopes: "mcp:read offline_access", scopes: ["mcp:read", "offline_access"], legacyConsent: true });
    const [key, stored] = [...f.storage.store.entries()].find(([key]) => key.startsWith("grant:"))!;
    const grant = JSON.parse(stored.value);
    const originalExpiry = grant.expiresAt;
    grant.metadata.refreshLifetime = "until-revoked";
    f.storage.store.set(key, { ...stored, value: JSON.stringify(grant) });
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 15 * 24 * 60 * 60 * 1000);
    const refreshed = await f.refresh(client, token.refresh_token!);
    expect(refreshed.status).toBe(200);
    const next = await refreshed.json() as TokenResponse;
    expect(JSON.parse(f.storage.store.get(key)!.value).expiresAt).toBe(originalExpiry);
    expect((await f.access(next.access_token)).status).toBe(200);
    expect(f.verifiedProps).not.toHaveProperty("refreshLifetime");
    clock.mockReturnValue(now + 31 * 24 * 60 * 60 * 1000);
    const expired = await f.refresh(client, next.refresh_token!);
    expect(expired.status).toBe(400);
    expect(await expired.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("retains the consent snapshot when a persistent form forges projects or wider scopes", async () => {
    const f = await fixture();
    const client = await f.register();
    const page = await f.consent(client);
    f.db.state.projects.push(project(UNKNOWN_PROJECT, "new-project", "Added after consent"));
    expect((await f.approve(page, { persistent: true, projects: [UNKNOWN_PROJECT] })).status).toBeGreaterThanOrEqual(400);
    for (const scope of ["mcp:write", "mcp:admin", "offline_access"]) {
      expect((await f.approve(page, { persistent: true, scopes: ["mcp:read", scope] })).status).toBeGreaterThanOrEqual(400);
    }
    const approved = await f.approve(page, { persistent: true, projects: [ATLAS] });
    const exchanged = await f.exchange(client, (await continuation(approved)).searchParams.get("code")!);
    expect(exchanged.status).toBe(200);
    const token = await exchanged.json() as TokenResponse;
    expect(token.scope).toBe("mcp:read");
    const access = await f.access(token.access_token);
    expect(access.status).toBe(200);
    expect(await access.json()).toMatchObject({ projectIds: [ATLAS], scopes: ["mcp:read"] });
  });

  it("refreshes read-only persistence after 31, 70 and 100 days while preserving projects, scopes and short access tokens", async () => {
    const f = await fixture();
    const { client, token } = await f.grant({ persistent: true, projects: [ATLAS] });
    const now = Date.now();
    const clock = vi.spyOn(Date, "now");
    let latest = token;
    for (const days of [31, 70, 100]) {
      clock.mockReturnValue(now + days * 24 * 60 * 60 * 1000);
      expect((await f.access(latest.access_token)).status).toBe(401);
      const refreshed = await f.refresh(client, latest.refresh_token!);
      expect(refreshed.status).toBe(200);
      const next = await refreshed.json() as TokenResponse;
      expect(next.refresh_token).toBeTruthy();
      expect(next.refresh_token).not.toBe(latest.refresh_token);
      expect(next.scope).toBe("mcp:read");
      expect(next.expires_in).toBe(900);
      const access = await f.access(next.access_token);
      expect(access.status).toBe(200);
      expect(await access.json()).toMatchObject({ projectIds: [ATLAS], scopes: ["mcp:read"] });
      latest = next;
    }
    const grant = [...f.storage.store.entries()].find(([key]) => key.startsWith("grant:"))![1];
    expect(JSON.parse(grant.value)).not.toHaveProperty("expiresAt");
    expect(grant.expiresAtMs).toBeNull();
    const markers = [...f.storage.store.entries()].filter(([key]) => key.startsWith("ui:used-refresh:"));
    expect(markers).toHaveLength(3);
    for (const [, marker] of markers) {
      expect(JSON.parse(marker.value)).toMatchObject({ refreshLifetime: "until-revoked", resource: RESOURCE, clientId: client.client_id });
      expect(JSON.parse(marker.value)).not.toHaveProperty("expiresAt");
      expect(marker.expiresAtMs).toBeNull();
    }
  });

  it("revokes persistent historical replay after 70 days and coordinator restart while refusing client or resource confusion", async () => {
    const f = await fixture();
    const { client, token } = await f.grant({ persistent: true });
    const now = Date.now();
    const clock = vi.spyOn(Date, "now");
    let latest = token;
    for (const days of [0, 31, 70]) {
      clock.mockReturnValue(now + days * 24 * 60 * 60 * 1000);
      const refreshed = await f.refresh(client, latest.refresh_token!);
      expect(refreshed.status).toBe(200);
      latest = await refreshed.json() as TokenResponse;
    }
    expect((await f.refresh(await f.register(), token.refresh_token!)).status).toBeGreaterThanOrEqual(400);
    expect((await f.refresh(client, token.refresh_token!, { resource: `${ORIGIN}/other` })).status).toBe(400);
    expect((await f.access(latest.access_token)).status).toBe(200);
    const restarted = createOpenWishOAuthProvider(f.env, f.storage as unknown as KVNamespace, async (_request, _env, _context, access) => Response.json(access));
    const replay = await restarted.fetch(new Request(`${ORIGIN}/oauth/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: token.refresh_token!, resource: RESOURCE }),
    }));
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
    expect((await restarted.fetch(new Request(RESOURCE, { headers: { Authorization: `Bearer ${latest.access_token}` } }))).status).toBe(401);
    expect((await f.refresh(client, latest.refresh_token!)).status).toBeGreaterThanOrEqual(400);
  });

  it("lets the dashboard administrator revoke a persistent read-only grant", async () => {
    const f = await fixture();
    const { client, token } = await f.grant({ persistent: true });
    const page = await f.request("/oauth/grants", { headers: { Cookie: f.dashboardCookie } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("until revoked");
    const values = new URLSearchParams({ csrf: hidden(html, "csrf"), grantId: hidden(html, "grantId") });
    const revoked = await f.formRequest("/oauth/grants", values, { Origin: ORIGIN, Cookie: `${f.dashboardCookie}; ${responseCookies(page)}` });
    expect([200, 302, 303]).toContain(revoked.status);
    expect((await f.access(token.access_token)).status).toBe(401);
    expect((await f.refresh(client, token.refresh_token!)).status).toBeGreaterThanOrEqual(400);
  });
});

describe("anonymous OAuth request resource limits", () => {
  it("rejects oversized bodies using both announced and actual request sizes", async () => {
    const f = await fixture();
    const announced = await f.request("/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": "20000" }, body: "small-body",
    });
    expect(announced.status).toBe(413);
    const actual = await f.request("/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "a".repeat(20_000),
    });
    expect(actual.status).toBe(413);
    expect((await f.request("/.well-known/oauth-authorization-server")).status).toBe(200);
  });

  it("does not let a slow body hold the OAuth queue and times it out without mutations", async () => {
    const f = await fixture();
    const initialKeys = f.storage.size();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const body = new ReadableStream<Uint8Array>({ start() {} });
    const slowRequest = new Request(`${ORIGIN}/oauth/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, duplex: "half",
    } as RequestInit);
    const slowResponse = f.provider.fetch(slowRequest);
    expect((await f.request("/.well-known/oauth-authorization-server")).status).toBe(200);
    await vi.advanceTimersByTimeAsync(5_001);
    expect((await slowResponse).status).toBe(408);
    expect(f.storage.size()).toBe(initialKeys);
  });
});

class MemoryDurableStorage {
  readonly records = new Map<string, unknown>();
  private alarm: number | null = null;

  async get<T>(key: string) {
    return this.records.get(key) as T | undefined;
  }

  async put(key: string, value: unknown) {
    this.records.set(key, structuredClone(value));
  }

  async delete(key: string) {
    return this.records.delete(key);
  }

  async list<T>(options: { prefix?: string; startAfter?: string; limit?: number } = {}) {
    const records = [...this.records.entries()]
      .filter(([key]) => (!options.prefix || key.startsWith(options.prefix)) && (!options.startAfter || key > options.startAfter))
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .slice(0, options.limit ?? Infinity);
    return new Map(records) as Map<string, T>;
  }

  async getAlarm() { return this.alarm; }
  async setAlarm(when: number | Date) { this.alarm = Number(when); }
  async deleteAlarm() { this.alarm = null; }
}

describe("strongly consistent OAuth storage", () => {
  it("stores JSON and metadata, enforces exact expiry, and deletes expired records on access", async () => {
    const memory = new MemoryDurableStorage();
    const storage = new DurableOAuthStorage(memory as unknown as DurableObjectStorage);
    const now = Date.now();
    await storage.put("test:grant", JSON.stringify({ projectIds: [STUDIO] }), { expiration: now / 1000 + 60, metadata: { owner: "synthetic-subject" } });
    expect(await storage.get("test:grant")).toBe(JSON.stringify({ projectIds: [STUDIO] }));
    expect(await storage.get("test:grant", "json")).toEqual({ projectIds: [STUDIO] });
    expect((await storage.list({ prefix: "test:" })).keys).toEqual([{ name: "test:grant", expiration: now / 1000 + 60, metadata: { owner: "synthetic-subject" } }]);
    vi.spyOn(Date, "now").mockReturnValue(now + 60_000);
    expect(await storage.get("test:grant", "json")).toBeNull();
    expect(memory.records.has("oauth:test:grant")).toBe(false);
  });

  it("paginates every live key once while filtering expired entries and preserving grant metadata", async () => {
    const memory = new MemoryDurableStorage();
    const storage = new DurableOAuthStorage(memory as unknown as DurableObjectStorage);
    const now = Date.now();
    await memory.put("other-application-state", { value: "untouched" });
    for (let index = 0; index < 10; index += 1) {
      await storage.put(`grant:${index}`, String(index), {
        expiration: now / 1000 + (index % 3 === 0 ? -1 : 3600),
        metadata: { index },
      });
    }
    await storage.put("different-prefix", "not-a-grant");
    const found: Array<{ name: string; metadata?: unknown }> = [];
    let cursor: string | undefined;
    do {
      const page = await storage.list({ prefix: "grant:", limit: 2, cursor });
      expect(page.keys.length).toBeLessThanOrEqual(2);
      found.push(...page.keys);
      if (page.list_complete) break;
      expect(page.cursor).toBeTruthy();
      expect(page.cursor).not.toBe(cursor);
      cursor = page.cursor;
    } while (found.length < 20);
    expect(found).toEqual([1, 2, 4, 5, 7, 8].map((index) => ({ name: `grant:${index}`, expiration: now / 1000 + 3600, metadata: { index } })));
    expect(new Set(found.map((entry) => entry.name)).size).toBe(found.length);
    expect(memory.records.has("other-application-state")).toBe(true);
    expect(await storage.get("different-prefix")).toBe("not-a-grant");
    for (const index of [0, 3, 6, 9]) expect(memory.records.has(`oauth:grant:${index}`)).toBe(false);
  });

  it("handles pages consisting solely of expired grants without exposing their keys", async () => {
    const memory = new MemoryDurableStorage();
    const storage = new DurableOAuthStorage(memory as unknown as DurableObjectStorage);
    for (let index = 0; index < 6; index += 1) await storage.put(`grant:${index}`, "expired", { expiration: Date.now() / 1000 - 1 });
    const page = await storage.list({ prefix: "grant:", limit: 2 });
    expect(page).toEqual({ keys: [], list_complete: true, cursor: "" });
    expect(memory.records.size).toBe(0);
  });

  it("purges abandoned expired records by alarm while keeping live and unrelated state", async () => {
    const memory = new MemoryDurableStorage();
    const storage = new DurableOAuthStorage(memory as unknown as DurableObjectStorage);
    const now = Date.now();
    await storage.put("consent:expired", "expired", { expiration: now / 1000 - 1 });
    await storage.put("grant:live", "live", { expiration: now / 1000 + 120 });
    await memory.put("unrelated", { value: "untouched" });
    await storage.purgeExpired();
    expect(memory.records.has("oauth:consent:expired")).toBe(false);
    expect(await storage.get("grant:live")).toBe("live");
    expect(memory.records.has("unrelated")).toBe(true);
    expect(await memory.getAlarm()).toBe(now + 120_000);
  });

  it("keeps indefinite replay markers beyond 30 days until their parent grant is removed", async () => {
    const memory = new MemoryDurableStorage();
    const storage = new DurableOAuthStorage(memory as unknown as DurableObjectStorage);
    const now = Date.now();
    for (const id of ["first", "other"]) {
      await storage.put(`grant:synthetic-user:${id}`, JSON.stringify({ metadata: { refreshLifetime: "until-revoked" } }));
      await storage.put(`ui:used-refresh:synthetic-hash-${id}`, JSON.stringify({
        userId: "synthetic-user", grantId: id, clientId: `synthetic-client-${id}`,
        resource: RESOURCE, refreshLifetime: "until-revoked",
      }));
    }
    await memory.put("unrelated", { value: "untouched" });
    vi.spyOn(Date, "now").mockReturnValue(now + 70 * 24 * 60 * 60 * 1000);
    await storage.purgeExpired();
    expect(await storage.get("ui:used-refresh:synthetic-hash-first", "json")).toMatchObject({ refreshLifetime: "until-revoked" });
    expect(await storage.get("ui:used-refresh:synthetic-hash-other", "json")).toMatchObject({ grantId: "other" });
    await storage.delete("grant:synthetic-user:first");
    await storage.purgeExpired();
    expect(await storage.get("ui:used-refresh:synthetic-hash-first")).toBeNull();
    expect(await storage.get("ui:used-refresh:synthetic-hash-other", "json")).toMatchObject({ grantId: "other" });
    expect(await storage.get("grant:synthetic-user:other")).toBeTruthy();
    expect(memory.records.get("unrelated")).toEqual({ value: "untouched" });
  });

  it("preserves indefinite replay history when checking its parent grant fails", async () => {
    const memory = new MemoryDurableStorage();
    const storage = new DurableOAuthStorage(memory as unknown as DurableObjectStorage);
    await storage.put("grant:synthetic-user:first", JSON.stringify({ metadata: { refreshLifetime: "until-revoked" } }));
    await storage.put("ui:used-refresh:synthetic-hash-first", JSON.stringify({
      userId: "synthetic-user", grantId: "first", clientId: "synthetic-client",
      resource: RESOURCE, refreshLifetime: "until-revoked",
    }));
    const read = vi.spyOn(memory, "get").mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("synthetic durable storage read failure"));
    await expect(storage.purgeExpired()).rejects.toThrow("synthetic durable storage read failure");
    expect(read).toHaveBeenLastCalledWith("oauth:grant:synthetic-user:first");
    expect(memory.records.has("oauth:ui:used-refresh:synthetic-hash-first")).toBe(true);
    expect(memory.records.has("oauth:grant:synthetic-user:first")).toBe(true);
    read.mockRestore();
    await storage.purgeExpired();
    expect(await storage.get("ui:used-refresh:synthetic-hash-first", "json")).toMatchObject({ refreshLifetime: "until-revoked" });
  });
});
