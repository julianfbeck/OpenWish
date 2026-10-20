import { DurableObject } from "cloudflare:workers";
import {
  AuthorizationError,
  CimdFetchError,
  OAuthError,
  OAuthProvider,
  getOAuthApi,
  type ConsentDescription,
  type OAuthHelpers,
  type OAuthProviderOptions,
  type OAuthResourceContext,
} from "@cloudflare/workers-oauth-provider";

import { requireProjectBySlug } from "./auth";
import { getDashboardSessionCookie, verifyDashboardSessionToken } from "./dashboardAuth";
import { loadProjectSummaries } from "./db";
import { handleOpenWishMcpRequest } from "./mcp";
import { dashboardMcpSubject, type McpAccess } from "./mcp-access";
import { DurableOAuthStorage, serializeOAuthRequests } from "./oauth-storage";
import type { Bindings } from "./types";

export const OPENWISH_OAUTH_SCOPES = ["mcp:read", "mcp:write", "mcp:admin", "offline_access"];
const ACCESS_SECONDS = 900;
const LEGACY_REFRESH_SECONDS = 30 * 24 * 60 * 60;
const CONSENT_SECONDS = 600;
/** Pre-ticked on the consent page: read plus write (replies, state changes).
 * Admin (delete/merge) and offline access always need an explicit tick. */
const DEFAULT_CONSENT_SCOPES = ["mcp:read", "mcp:write"];
const BODY_DEADLINE_MS = 5000;
const JWT_CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const GRANTS_COOKIE = "__Host-openwish-oauth-grants";
const scopeLabels: Record<string, string> = {
  "mcp:read": "Read feedback, bugs, screenshots and analytics",
  "mcp:write": "Create or update feedback, replies, notes and project settings; send emails",
  "mcp:admin": "Delete feedback or selected projects; merge features",
  offline_access: "Keep this connection until I revoke it (offline access)",
};

type OAuthEnv = Bindings & { OAUTH_KV: KVNamespace; OAUTH_PROVIDER?: OAuthHelpers };
type ProjectChoice = { id: string; name: string; slug: string };
type ConsentPolicy = { subject: string; scopes: string[]; projectIds: string[]; allowsPersistentRefresh?: true };
type GrantPolicy = { subject: string; grantIds: string[] };
type OAuthProps = { subject: string; projectIds: string[]; scopes: string[]; refreshLifetime?: "until-revoked" };
type UsedRefresh = {
  clientId: string; userId: string; grantId: string; resource: string;
  expiresAt?: number; refreshLifetime?: "until-revoked";
};
export type OAuthMcpHandler = (
  request: Request, env: Bindings, context: ExecutionContext, access: McpAccess,
) => Promise<Response>;

class RequestBodyError extends Error {
  constructor(readonly status: number) { super("Request body could not be accepted."); }
}

/** Do not let an anonymous slow upload own the global OAuth mutation queue.
 * Buffer a small bounded body first, with a deadline for both headers and chunks.
 */
async function boundedRequest(request: Request) {
  if (!request.body) return request;
  const maximum = new URL(request.url).pathname === "/mcp" ? 262_144 : 16_384;
  const announced = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(announced) && announced > maximum) throw new RequestBodyError(413);
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await Promise.race([
      (async () => {
        const chunks: Uint8Array[] = [];
        let length = 0;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > maximum) {
            void reader.cancel().catch(() => undefined);
            throw new RequestBodyError(413);
          }
          chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return bytes;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void reader.cancel().catch(() => undefined);
          reject(new RequestBodyError(408));
        }, BODY_DEADLINE_MS);
      }),
    ]);
    return new Request(request, { body });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function escape(value: string) {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function html(body: string, status = 200, existing?: Headers) {
  const headers = new Headers(existing);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  // Forms only post back here. Leaving for the client goes through continueTo().
  headers.set("Content-Security-Policy", "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; style-src 'unsafe-inline'");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  // Native form POSTs with no-referrer send Origin: null in browsers.
  // Preserve our strict own-origin CSRF check without sending referrers to clients.
  headers.set("Referrer-Policy", "same-origin");
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OpenWish MCP access</title><style>body{font:16px system-ui;max-width:720px;margin:48px auto;padding:0 24px;line-height:1.6}label{display:block;margin:12px 0}button{padding:8px 16px;margin:8px 12px 8px 0}fieldset{margin:20px 0}small{display:block;color:#555}</style><body>${body}</body></html>`, { status, headers });
}

/** Leave the consent form through a page of our own instead of a 302. Chromium
 * applies the form's `form-action` CSP to every redirect after a form POST, so a
 * callback that redirects again (www.cursor.com → cursor.com) or uses an app
 * scheme was blocked silently, and a second click then failed as already used.
 * A meta refresh is a fresh navigation that form-action does not govern.
 * `location` is the provider's redirect to the validated client callback. */
function continueTo(location: string, existing: Headers) {
  const target = new URL(location);
  const name = target.host || target.protocol.replace(/:$/, "");
  const headers = new Headers(existing);
  headers.delete("Location");
  return html(`<meta http-equiv="refresh" content="0;url=${escape(location)}"><h1>Returning to ${escape(name)}</h1><p>If nothing happens, <a href="${escape(location)}">continue to ${escape(name)}</a>.</p>`, 200, headers);
}

function unavailable() {
  return new Response("OpenWish OAuth is not configured or temporarily unavailable.", {
    status: 503, headers: { "Cache-Control": "no-store" },
  });
}

function invalid(message = "This authorization is invalid or expired. Start again.", status = 400) {
  return html(`<h1>Authorization could not continue</h1><p>${escape(message)}</p>`, status);
}

/** Show the provider's own reason (written for people; never a token) and log it,
 * so a failed connection attempt can be diagnosed from `wrangler tail`. */
function rejected(stage: "request" | "consent", error: unknown, fallback?: string) {
  const reason = error instanceof AuthorizationError ? error.description
    : error instanceof CimdFetchError ? `The application's client metadata could not be loaded (${error.detail})`
    : fallback;
  console.warn("[openwish] OAuth authorization rejected", JSON.stringify({
    stage,
    error: error instanceof Error ? error.name : String(error),
    code: error instanceof AuthorizationError ? error.code : undefined,
    reason: reason ?? (error instanceof Error ? error.message : undefined),
  }));
  return invalid(reason ? `${reason.replace(/[.;\s]+$/, "")}. Start the connection again from the application.` : undefined);
}

export function openWishOAuthOrigin(env: Bindings): string | null {
  if (!env.OPENWISH_MCP_OAUTH_ORIGIN) return null;
  try {
    const url = new URL(env.OPENWISH_MCP_OAUTH_ORIGIN);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

export function isOpenWishOAuthPath(pathname: string) {
  return ["/oauth/authorize", "/oauth/token", "/oauth/register", "/oauth/revoke", "/oauth/grants",
    "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp"].includes(pathname);
}

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signedInSubject(request: Request, env: Bindings) {
  // Consent must be a human dashboard session. Bearer/API/admin tokens cannot grant access.
  const token = getDashboardSessionCookie(request);
  if (!token) return null;
  const session = await verifyDashboardSessionToken(env, token);
  return session ? dashboardMcpSubject(session.username) : null;
}

function loginRequired(request: Request) {
  const url = new URL(request.url);
  const next = `${url.pathname}${url.search}`;
  return html(`<h1>Sign in to OpenWish</h1><p>Sign in to your administrator dashboard, then return here to approve MCP access.</p><p><a href="/login?next=${escape(encodeURIComponent(next))}">Sign in</a></p>`, 401);
}

async function projects(env: Bindings): Promise<ProjectChoice[]> {
  const summaries = await loadProjectSummaries(env.DB);
  const choices: ProjectChoice[] = [];
  for (const summary of summaries) {
    const found = await requireProjectBySlug({ env }, summary.slug);
    if (found.ok) choices.push({ id: found.project.id, name: summary.name, slug: summary.slug });
  }
  return choices;
}

async function readForm(request: Request, fields: string[]) {
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    throw new AuthorizationError("invalid_request", { description: "Invalid request." });
  }
  const reader = request.body?.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  if (reader) for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > 16_384) { await reader.cancel(); throw new AuthorizationError("invalid_request", { description: "Invalid request." }); }
    chunks.push(chunk.value);
  }
  const value = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { value.set(chunk, offset); offset += chunk.length; }
  const form = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(value));
  if ([...form.keys()].some((field) => !fields.includes(field))) throw new AuthorizationError("invalid_request", { description: "Invalid request." });
  return form;
}

function one(form: URLSearchParams, key: string) {
  const values = form.getAll(key);
  if (values.length !== 1 || !values[0]) throw new AuthorizationError("invalid_request", { description: "Invalid request." });
  return values[0];
}

function consentPage(details: ConsentDescription, handle: string, choices: ProjectChoice[], scopes: string[], requested: string[]) {
  const publisher = details.clientDomain
    ? `<p>Published by <strong>${escape(details.clientDomain)}</strong>.</p>`
    : "<p>This application registered itself; its name is not verified.</p>";
  return `<h1>Allow ${escape(details.clientName)} to access OpenWish?</h1>${publisher}
    <p>Access returns to <strong>${escape(details.redirectHost)}</strong>.</p>
    ${details.redirectIsLoopback ? "<p>Only continue if you just started signing in from an app on your computer.</p>" : ""}
    <p>You are signed in as an OpenWish administrator. Choose the existing projects this application may access. Future projects are excluded.</p>
    <form method="post" action="/oauth/authorize"><input type="hidden" name="handle" value="${escape(handle)}">
    <fieldset><legend>Permissions</legend>${scopes.map((scope) => `<label><input type="checkbox" name="scope" value="${escape(scope)}"${DEFAULT_CONSENT_SCOPES.includes(scope) ? " checked" : ""}> ${escape(scopeLabels[scope])}${requested.includes(scope) ? "" : " <small>Not requested by this application.</small>"}</label>`).join("")}</fieldset>
    <fieldset><legend>Connection duration</legend>
    ${scopes.includes("offline_access") ? "<p>The optional offline access permission above allows automatic renewal until you revoke this connection.</p>" : '<label><input type="checkbox" name="persistent" value="until-revoked"> Keep this connection until I revoke it (offline access)</label>'}
    <p>Automatic renewal has no fixed expiration. Access tokens still expire after 15 minutes, and access remains limited to your selected projects and permissions. You can revoke the connection at any time in Manage OAuth access. Without automatic renewal, this authorization expires after 15 minutes.</p></fieldset>
    <fieldset><legend>Projects — select at least one</legend>${choices.map((project) => `<label><input type="checkbox" name="project" value="${escape(project.id)}"> ${escape(project.name)} <small>${escape(project.slug)}</small></label>`).join("")}</fieldset>
    <p>New project creation and API credentials are excluded. Write permission can send replies and emails; administrator permission can delete selected projects.</p>
    <button name="decision" value="approve">Allow selected access</button><button name="decision" value="deny">Deny</button></form>`;
}

async function authorizationPage(request: Request, env: OAuthEnv, origin: string) {
  const oauth = env.OAUTH_PROVIDER!;
  const subject = await signedInSubject(request, env);
  if (!subject) return loginRequired(request);
  if (request.method === "GET") {
    try {
      const query = new URL(request.url).searchParams;
      if ([...query.keys()].some((key) => query.getAll(key).length !== 1) ||
        query.get("code_challenge_method") !== "S256" ||
        !/^[A-Za-z0-9_-]{43}$/.test(query.get("code_challenge") ?? "")) return invalid("A single authorization request with S256 PKCE is required.");
      if (query.get("resource") !== `${origin}/mcp`) return invalid("The canonical OpenWish MCP resource is required.");
      const parsed = await oauth.parseAuthRequest(request);
      if (parsed.scope.some((scope) => !OPENWISH_OAUTH_SCOPES.includes(scope))) {
        return invalid("The application requested an unsupported permission.");
      }
      // Missing scopes get the advertised read baseline, never write/admin/offline access.
      const requested = [...new Set(["mcp:read", ...parsed.scope])];
      const authRequest = { ...parsed, scope: requested };
      // Clients follow the read-only challenge and request only mcp:read, so the
      // owner may additionally grant write/admin (write is pre-ticked, admin is not).
      // offline_access is offered only when requested; otherwise the separate
      // persistence choice covers renewal without adding an unrequested scope.
      const scopes = OPENWISH_OAUTH_SCOPES.filter((scope) => scope !== "offline_access" || requested.includes(scope));
      const details = await oauth.describeConsent(authRequest);
      const choices = await projects(env);
      const consent = await oauth.beginConsent(authRequest);
      await env.OAUTH_KV.put(`ui:consent:${await digest(consent.handle)}`, JSON.stringify({
        subject, scopes, projectIds: choices.map((project) => project.id), allowsPersistentRefresh: true,
      } satisfies ConsentPolicy), { expirationTtl: CONSENT_SECONDS });
      return html(consentPage(details, consent.handle, choices, scopes, requested), 200, consent.headers);
    } catch (error) {
      // Only parseAuthRequest's validated redirect context is safe to use.
      if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
      if (error instanceof AuthorizationError || error instanceof CimdFetchError) return rejected("request", error);
      throw error;
    }
  }
  if (request.method !== "POST") return invalid("Use GET or POST.", 405);
  if (request.headers.get("Origin") !== origin) return invalid("The request must originate from this OpenWish dashboard.", 403);
  try {
    const form = await readForm(request, ["handle", "decision", "scope", "project", "persistent"]);
    const handle = one(form, "handle");
    const policyKey = `ui:consent:${await digest(handle)}`;
    const policy = await env.OAUTH_KV.get<ConsentPolicy>(policyKey, "json");
    if (!policy || policy.subject !== subject) {
      return rejected("consent", policy ? "subject-mismatch" : "policy-missing",
        "This consent page expired after 10 minutes or belongs to another sign-in");
    }
    const decision = one(form, "decision");
    if (decision === "deny") {
      const denied = await oauth.denyConsent(request, handle);
      await env.OAUTH_KV.delete(policyKey);
      return continueTo(denied.redirectTo, denied.headers);
    }
    if (decision !== "approve") return invalid();
    const scopes = [...new Set(form.getAll("scope"))];
    const projectIds = [...new Set(form.getAll("project"))];
    const persistent = form.getAll("persistent");
    if (persistent.length > 1 || persistent.some((value) => value !== "until-revoked") ||
      (persistent.length && policy.allowsPersistentRefresh !== true)) return invalid();
    // This server-owned policy distinguishes fresh, explicit indefinite consent
    // from an older form that only offered a 30-day offline authorization.
    const refreshLifetime = policy.allowsPersistentRefresh === true &&
      (persistent.length === 1 || scopes.includes("offline_access")) ? "until-revoked" as const : undefined;
    const currentProjects = await projects(env);
    if (!scopes.includes("mcp:read") || scopes.some((scope) => !policy.scopes.includes(scope)) ||
      !projectIds.length || projectIds.some((id) => !policy.projectIds.includes(id) || !currentProjects.some((project) => project.id === id))) {
      return invalid("Choose read access and at least one listed project. Permissions cannot exceed the displayed request.");
    }
    const approved = await oauth.approveConsent(request, handle, { scope: scopes });
    await env.OAUTH_KV.delete(policyKey);
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request, userId: subject, scope: scopes,
      metadata: { clientName: (await oauth.describeConsent(approved.request)).clientName,
        projectNames: currentProjects.filter((project) => projectIds.includes(project.id)).map((project) => project.name), projectIds,
        ...(refreshLifetime ? { refreshLifetime } : {}) },
      props: { subject, projectIds, scopes, ...(refreshLifetime ? { refreshLifetime } : {}) } satisfies OAuthProps,
    });
    return continueTo(redirectTo, approved.headers);
  } catch (error) {
    // Errors after a form submission have no trusted redirect context.
    if (error instanceof AuthorizationError || error instanceof CimdFetchError || error instanceof TypeError) return rejected("consent", error);
    throw error;
  }
}

async function allGrants(oauth: OAuthHelpers, subject: string) {
  const result = [];
  let cursor: string | undefined;
  do {
    const page = await oauth.listUserGrants(subject, { limit: 100, cursor });
    result.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return result;
}

async function grantPage(request: Request, env: OAuthEnv, origin: string) {
  const subject = await signedInSubject(request, env);
  if (!subject) return loginRequired(request);
  const oauth = env.OAUTH_PROVIDER!;
  if (request.method === "GET") {
    const grants = await allGrants(oauth, subject);
    const csrf = crypto.randomUUID();
    const hashed = await digest(csrf);
    await env.OAUTH_KV.put(`ui:grants:${hashed}`, JSON.stringify({ subject, grantIds: grants.map((grant) => grant.id) } satisfies GrantPolicy), { expirationTtl: 600 });
    const headers = new Headers({ "Set-Cookie": `${GRANTS_COOKIE}=${hashed}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600` });
    return html(`<h1>MCP connections</h1><p>Revoke access for applications you previously approved. Existing API-key access is managed separately.</p>${grants.map((grant) => {
      const name = typeof grant.metadata?.clientName === "string" ? grant.metadata.clientName : grant.clientId;
      const projectNames = Array.isArray(grant.metadata?.projectNames) ? grant.metadata.projectNames.filter((name: unknown) => typeof name === "string").join(", ") : "Selected projects";
      const duration = grant.metadata?.refreshLifetime === "until-revoked"
        ? "Automatic renewal until revoked — no fixed expiration. Access tokens last 15 minutes."
        : typeof grant.expiresAt === "number" ? `Expires at ${new Date(grant.expiresAt * 1000).toISOString()}.` : "Existing authorization.";
      return `<section><h2>${escape(name)}</h2><p>${escape(projectNames)}</p><p>${escape(grant.scope.join(", "))}</p><p>${escape(duration)}</p><small>Client: ${escape(grant.clientId)}</small><form method="post" action="/oauth/grants"><input type="hidden" name="csrf" value="${escape(csrf)}"><input type="hidden" name="grantId" value="${escape(grant.id)}"><button>Revoke access</button></form></section>`;
    }).join("") || "<p>No active connections.</p>"}`, 200, headers);
  }
  if (request.method !== "POST") return invalid("Use GET or POST.", 405);
  if (request.headers.get("Origin") !== origin) return invalid("The request must originate from this OpenWish dashboard.", 403);
  try {
    const form = await readForm(request, ["csrf", "grantId"]);
    const csrf = one(form, "csrf");
    const grantId = one(form, "grantId");
    const hashed = await digest(csrf);
    const cookie = request.headers.get("Cookie")?.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${GRANTS_COOKIE}=`))?.slice(GRANTS_COOKIE.length + 1);
    const policy = await env.OAUTH_KV.get<GrantPolicy>(`ui:grants:${hashed}`, "json");
    if (cookie !== hashed || !policy || policy.subject !== subject || !policy.grantIds.includes(grantId)) return invalid();
    await env.OAUTH_KV.delete(`ui:grants:${hashed}`);
    await oauth.revokeGrant(grantId, subject);
    return new Response(null, { status: 303, headers: { Location: "/oauth/grants", "Cache-Control": "no-store", "Set-Cookie": `${GRANTS_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0` } });
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof TypeError) return invalid();
    throw error;
  }
}

async function registrationLimited(request: Request, storage: KVNamespace) {
  const window = Math.floor(Date.now() / 600_000);
  const ip = await digest(request.headers.get("CF-Connecting-IP") ?? "unknown");
  for (const [key, limit] of [[`ui:register:${window}:${ip}`, 10], [`ui:register:${window}:global`, 100]] as const) {
    const count = Number(await storage.get(key) ?? "0");
    if (count >= limit) return true;
    await storage.put(key, String(count + 1), { expirationTtl: 600 });
  }
  return false;
}

function protocolError(error: string, description: string) {
  return Response.json({ error, error_description: description }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

async function protocolPreflight(request: Request, resource: string): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (request.method !== "POST" || !["/oauth/token", "/oauth/revoke"].includes(path)) return null;
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") return null;
  const form = new URLSearchParams(await request.clone().text());
  // A replay probe must never turn an ambiguous request into valid client auth.
  // This deployment serves exactly one resource; repeated resource parameters
  // are therefore unnecessary as well.
  if ([...form.keys()].some((key) => form.getAll(key).length !== 1)) {
    return protocolError("invalid_request", "Token request parameters must not be repeated.");
  }
  if (path === "/oauth/revoke" && (form.getAll("token").length !== 1 || !form.get("token") || form.has("grant_type"))) {
    return protocolError("invalid_request", "A token revocation request is required.");
  }
  if (["authorization_code", "refresh_token"].includes(form.get("grant_type") ?? "") && form.get("resource") !== resource) {
    return protocolError("invalid_target", "The canonical OpenWish MCP resource is required.");
  }
  if (form.get("grant_type") === "authorization_code" &&
    (form.getAll("code_verifier").length !== 1 || !/^[A-Za-z0-9._~-]{43,128}$/.test(form.get("code_verifier") ?? ""))) {
    return protocolError("invalid_request", "An RFC 7636 S256 PKCE verifier is required.");
  }
  return null;
}

/** Read identity only after the library has successfully authenticated Basic.
 * Password verification remains entirely inside the maintained provider.
 */
function authenticatedBasicClientId(header: string) {
  const end = header.search(/[ \t]/);
  const credentials = atob(header.slice(end).trim());
  return decodeURIComponent(credentials.slice(0, credentials.indexOf(":")).replace(/\+/g, " "));
}

function isUsedRefresh(value: unknown, resource: string): value is UsedRefresh {
  if (!value || typeof value !== "object") return false;
  const marker = value as Partial<UsedRefresh>;
  return typeof marker.clientId === "string" && !!marker.clientId &&
    typeof marker.userId === "string" && !!marker.userId &&
    typeof marker.grantId === "string" && !!marker.grantId &&
    marker.resource === resource && (marker.expiresAt === undefined
      ? marker.refreshLifetime === "until-revoked"
      : Number.isInteger(marker.expiresAt) && marker.expiresAt > Math.floor(Date.now() / 1000));
}

function hasPersistentRefresh(props: unknown): props is { refreshLifetime: "until-revoked" } {
  return !!props && typeof props === "object" &&
    (props as Partial<OAuthProps>).refreshLifetime === "until-revoked";
}

/** All calls returned by this factory share one queue, including the real library's
 * protocol requests and resource validation. Production uses one named DO only. */
export function createOpenWishOAuthProvider(
  env: Bindings, storage?: KVNamespace, mcpHandler: OAuthMcpHandler = handleOpenWishMcpRequest,
) {
  const origin = openWishOAuthOrigin(env);
  if (!origin || !storage) throw new TypeError("A canonical OAuth origin and serialized storage are required.");
  const oauthEnv: OAuthEnv = { ...env, OAUTH_KV: storage };
  let currentRefreshHash: string | null = null;
  const providerOptions: OAuthProviderOptions<OAuthEnv> = {
    apiRoute: `${origin}/mcp`,
    authorizeEndpoint: `${origin}/oauth/authorize`,
    tokenEndpoint: `${origin}/oauth/token`,
    clientRegistrationEndpoint: `${origin}/oauth/register`,
    // Explicit undefined overrides the provider's default 30-day deadline.
    // Only fresh, server-recorded consent may select this indefinite lifetime.
    accessTokenTTL: ACCESS_SECONDS, refreshTokenTTL: undefined,
    clientRegistrationTTL: 90 * 24 * 60 * 60,
    scopesSupported: OPENWISH_OAUTH_SCOPES,
    requiredScopes: ["mcp:read"],
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin] },
    onError: () => undefined,
    async tokenExchangeCallback(options) {
      if (options.grantType === "authorization_code") {
        if (hasPersistentRefresh(options.props)) return undefined;
        return { refreshTokenTTL: options.scope.includes("offline_access") ? LEGACY_REFRESH_SECONDS : 0 };
      }
      if (options.grantType === "refresh_token") {
        // The callback runs only after the provider verifies the token, client,
        // grant expiry and requested resource. A malformed token cannot poison
        // another grant's replay marker or revoke it.
        if (!currentRefreshHash) throw new OAuthError("invalid_grant", { description: "Refresh authorization could not be verified." });
        const key = `ui:used-refresh:${currentRefreshHash}`;
        if (await storage.get(key)) {
          await options.env.OAUTH_PROVIDER!.revokeGrant(options.grantId, options.userId);
          throw new OAuthError("invalid_grant", { description: "Refresh token already used. Reconnect the application." });
        }
        // Strong DO storage plus the request queue makes this reservation single
        // use. Failures after reservation require reconnecting, never a grace retry.
        const grant = await storage.get<{ expiresAt?: number; metadata?: { refreshLifetime?: string } }>(`grant:${options.userId}:${options.grantId}`, "json");
        const validLifetime = grant && (grant.expiresAt === undefined
          ? hasPersistentRefresh(options.props) && grant.metadata?.refreshLifetime === "until-revoked"
          : Number.isInteger(grant.expiresAt) && grant.expiresAt > Math.floor(Date.now() / 1000));
        if (!validLifetime || !grant || options.resource !== `${origin}/mcp`) {
          throw new OAuthError("invalid_grant", { description: "Refresh authorization could not be verified." });
        }
        const marker: UsedRefresh = {
          clientId: options.clientId, userId: options.userId, grantId: options.grantId,
          resource: options.resource, ...(grant.expiresAt === undefined
            ? { refreshLifetime: "until-revoked" as const } : { expiresAt: grant.expiresAt }),
        };
        await storage.put(key, JSON.stringify(marker), marker.expiresAt === undefined ? undefined : { expiration: marker.expiresAt });
      }
      return undefined;
    },
    apiHandler: {
      async fetch(request, currentEnv, context) {
        const verified = context as OAuthResourceContext<OAuthProps>;
        const props = verified.props;
        if (!props || typeof props.subject !== "string" || !props.subject || verified.auth.userId !== props.subject || !Array.isArray(props.projectIds) ||
          !props.projectIds.length || props.projectIds.some((id) => typeof id !== "string") ||
          !Array.isArray(props.scopes)) return invalid("Invalid access grant.", 403);
        const scopes = verified.auth.scope.filter((scope) => props.scopes.includes(scope) && OPENWISH_OAUTH_SCOPES.includes(scope));
        if (!scopes.includes("mcp:read")) return new Response("Read permission required.", {
          status: 403, headers: { "Cache-Control": "no-store", "WWW-Authenticate": `Bearer error="insufficient_scope", scope="mcp:read", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` },
        });
        const response = await mcpHandler(request, currentEnv, context, { mode: "oauth", subject: props.subject, projectIds: props.projectIds, scopes });
        // Stateless MCP responses are finite. Finish tool execution/streaming before
        // releasing the queue, so a following revoke cannot race an in-flight tool.
        if (response.body) return new Response(await response.arrayBuffer(), { status: response.status, statusText: response.statusText, headers: response.headers });
        return response;
      },
    },
    defaultHandler: {
      fetch(request, currentEnv) {
        const path = new URL(request.url).pathname;
        if (path === "/oauth/authorize") return authorizationPage(request, currentEnv, origin);
        if (path === "/oauth/grants") return grantPage(request, currentEnv, origin);
        return new Response("Not found.", { status: 404 });
      },
    },
  };
  const provider = new OAuthProvider<OAuthEnv>(providerOptions);
  // Also available after a DO restart, before any new authorization-page request.
  oauthEnv.OAUTH_PROVIDER = getOAuthApi(providerOptions, oauthEnv);
  type Job = { request: Request; context?: ExecutionContext } | { maintenance: () => Promise<void> };
  const serialized = serializeOAuthRequests<Job>(async (job) => {
    if ("maintenance" in job) {
      await job.maintenance();
      return new Response(null, { status: 204 });
    }
    let { request } = job;
    const { context } = job;
    const url = new URL(request.url);
    if (url.origin !== origin) return invalid("OAuth requests must use the configured origin.", 421);
    if (url.pathname !== "/mcp" && !isOpenWishOAuthPath(url.pathname)) return new Response("Not found.", { status: 404 });
    if (url.pathname === "/oauth/register" && request.method === "POST" && await registrationLimited(request, storage)) {
      return new Response("Too many client registrations.", { status: 429, headers: { "Retry-After": "600", "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/oauth/revoke") {
      url.pathname = "/oauth/token";
      request = new Request(url, request);
    }
    // The provider writes props/auth onto its context. Use a fresh plain object
    // per request instead of mutating the DO's native DurableObjectState.
    const executionContext = {
      waitUntil: (promise: Promise<unknown>) => context?.waitUntil(promise),
      passThroughOnException: () => undefined,
      props: {},
    } as unknown as ExecutionContext;
    try {
      if (url.pathname === "/oauth/token" && request.method === "POST" &&
        request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() === "application/x-www-form-urlencoded") {
        const form = new URLSearchParams(await request.clone().text());
        if (form.get("grant_type") === "refresh_token" && form.getAll("refresh_token").length === 1 && form.get("refresh_token")) {
          currentRefreshHash = await digest(form.get("refresh_token")!);
          const marker = await storage.get<unknown>(`ui:used-refresh:${currentRefreshHash}`, "json");
          if (marker) {
            // The library only remembers the current and immediately preceding
            // refresh token. Our verified marker also detects older replays.
            if (!isUsedRefresh(marker, `${origin}/mcp`) || form.get("resource") !== marker.resource) {
              return protocolError("invalid_grant", "Refresh authorization could not be verified.");
            }
            const authorization = request.headers.get("Authorization") ?? "";
            const basic = /^Basic(?:[ \t]|$)/i.test(authorization);
            const assertionWithoutId = !form.has("client_id") && !!form.get("client_assertion") &&
              form.get("client_assertion_type") === JWT_CLIENT_ASSERTION_TYPE;
            if (basic ? ["client_id", "client_secret", "client_assertion", "client_assertion_type"].some((key) => form.has(key))
              : !assertionWithoutId && form.get("client_id") !== marker.clientId) {
              return protocolError("invalid_grant", "Refresh authorization could not be verified.");
            }
            // RFC 7009 returns 200 for an unknown token only AFTER registered or
            // CIMD client authentication. Keep the original endpoint (JWT aud),
            // headers and auth fields; do not invent an owner client identity.
            const probe = new URLSearchParams(form);
            // private_key_jwt permits the body client_id to be omitted. The
            // provider checks the signed iss/sub against this trusted owner ID;
            // never trust an unverified assertion claim to pick a grant owner.
            if (assertionWithoutId) probe.set("client_id", marker.clientId);
            for (const key of ["grant_type", "refresh_token", "scope", "resource", "token_type_hint"]) probe.delete(key);
            probe.set("token", crypto.randomUUID()); // Cannot match an issued token.
            const headers = new Headers(request.headers);
            headers.delete("Content-Length");
            const authenticated = await provider.fetch(new Request(request.url, { method: "POST", headers, body: probe }), oauthEnv, executionContext);
            if (authenticated.status !== 200) return authenticated;
            if (basic && authenticatedBasicClientId(authorization) !== marker.clientId) {
              return protocolError("invalid_grant", "Refresh authorization could not be verified.");
            }
            await oauthEnv.OAUTH_PROVIDER!.revokeGrant(marker.grantId, marker.userId);
            return protocolError("invalid_grant", "Refresh token already used. Reconnect the application.");
          }
        }
      }
      return await provider.fetch(request, oauthEnv, executionContext);
    } catch { return unavailable(); } // Fail closed without logging bearer credentials or provider details.
    finally { currentRefreshHash = null; }
  });
  return {
    fetch: async (request: Request, context?: ExecutionContext) => {
      // Origin and routes are public, non-mutating checks before accepting a body.
      const url = new URL(request.url);
      if (url.origin !== origin) return invalid("OAuth requests must use the configured origin.", 421);
      if (url.pathname !== "/mcp" && !isOpenWishOAuthPath(url.pathname)) return new Response("Not found.", { status: 404 });
      try {
        const buffered = await boundedRequest(request);
        const preflight = await protocolPreflight(buffered, `${origin}/mcp`);
        return preflight ?? await serialized({ request: buffered, context });
      }
      catch (error) {
        return new Response("Request could not be accepted.", {
          status: error instanceof RequestBodyError ? error.status : 503,
          headers: { "Cache-Control": "no-store" },
        });
      }
    },
    maintenance: async (run: () => Promise<void>) => { await serialized({ maintenance: run }); },
  };
}

/** One instance for the entire deployment. Never derive its name from a project,
 * token, client or user: consent and token lifecycle must share the same queue. */
export class OpenWishOAuthState extends DurableObject<Bindings> {
  private readonly oauth: ReturnType<typeof createOpenWishOAuthProvider>;
  private readonly storage: DurableOAuthStorage;
  constructor(state: DurableObjectState, env: Bindings) {
    super(state, env);
    this.storage = new DurableOAuthStorage(state.storage);
    this.oauth = createOpenWishOAuthProvider(env, this.storage.asKVNamespace());
  }
  fetch(request: Request) { return this.oauth.fetch(request, this.ctx as unknown as ExecutionContext); }
  alarm() { return this.oauth.maintenance(() => this.storage.purgeExpired()); }
}

export async function handleOpenWishOAuthRequest(request: Request, env: Bindings) {
  const origin = openWishOAuthOrigin(env);
  if (!origin || !env.MCP_OAUTH_STATE) return unavailable();
  if (new URL(request.url).origin !== origin) return invalid("OAuth requests must use the configured origin.", 421);
  try {
    const id = env.MCP_OAUTH_STATE.idFromName("openwish-oauth-v1");
    return await env.MCP_OAUTH_STATE.get(id).fetch(request);
  } catch { return unavailable(); }
}

export const handleOAuthRequest = handleOpenWishOAuthRequest;
