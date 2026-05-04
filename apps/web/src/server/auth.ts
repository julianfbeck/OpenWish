import { getDashboardSessionCookie, verifyDashboardSessionToken } from "./dashboardAuth";
import { publicError, sdkError } from "./http";
import type { Bindings, ProjectRow } from "./types";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function projectByField(
  db: D1Database,
  field: "api_key" | "slug",
  value: string,
): Promise<ProjectRow | null> {
  const result = await db
    .prepare(`SELECT * FROM projects WHERE ${field} = ? LIMIT 1`)
    .bind(value)
    .first<ProjectRow>();

  return result ?? null;
}

function extractBearerToken(request: Request) {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || null;
}

function extractDashboardSessionToken(request: Request) {
  return getDashboardSessionCookie(request) ?? extractBearerToken(request);
}

type RequestLike = {
  env: Bindings;
  request: Request;
};

export async function requireProjectFromApiKey({ env, request }: RequestLike) {
  const apiKey = request.headers.get("x-wishkit-api-key");

  if (!apiKey) {
    return { ok: false as const, response: sdkError("missingApiHeaderKey", 401) };
  }

  const project = await projectByField(env.DB, "api_key", apiKey);
  if (!project) {
    return { ok: false as const, response: sdkError("wrongBearerToken", 401) };
  }

  return { ok: true as const, project };
}

export async function requireProjectBySlug({ env }: Omit<RequestLike, "request">, slug: string) {
  const project = await projectByField(env.DB, "slug", slug);
  if (!project) {
    return { ok: false as const, response: publicError(404, "Project not found.") };
  }

  return { ok: true as const, project };
}

export async function requireAdminProject({ env, request }: RequestLike, slug: string) {
  const projectResult = await requireProjectBySlug({ env }, slug);
  if (!projectResult.ok) {
    return projectResult;
  }

  const sessionToken = extractDashboardSessionToken(request);
  if (sessionToken) {
    const session = await verifyDashboardSessionToken(env, sessionToken);
    if (session) {
      return {
        ...projectResult,
        authMode: "dashboard" as const,
        session,
      };
    }
  }

  const adminToken = request.headers.get("x-openwish-admin-token");

  if (!adminToken || adminToken !== projectResult.project.admin_token) {
    return { ok: false as const, response: publicError(401, "Dashboard login required.") };
  }

  return {
    ...projectResult,
    authMode: "project-token" as const,
  };
}

export async function requireDashboardSession({ env, request }: RequestLike) {
  const sessionToken = extractDashboardSessionToken(request);
  if (!sessionToken) {
    return { ok: false as const, response: publicError(401, "Dashboard login required.") };
  }

  const session = await verifyDashboardSessionToken(env, sessionToken);
  if (!session) {
    return { ok: false as const, response: publicError(401, "Dashboard login required.") };
  }

  return {
    ok: true as const,
    session,
  };
}

export function requireUserUuid(request: Request, mode: "sdk" | "public") {
  const candidate =
    request.headers.get("x-wishkit-uuid") ?? request.headers.get("x-openwish-user-uuid") ?? "";

  if (!candidate) {
    return mode === "sdk"
      ? { ok: false as const, response: sdkError("missingUUIDHeaderKey", 401) }
      : { ok: false as const, response: publicError(401, "User UUID header is required.") };
  }

  if (!uuidPattern.test(candidate)) {
    return mode === "sdk"
      ? { ok: false as const, response: sdkError("missingUUIDHeaderKey", 400) }
      : { ok: false as const, response: publicError(400, "User UUID must be a valid UUID.") };
  }

  return { ok: true as const, uuid: candidate };
}
