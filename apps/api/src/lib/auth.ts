import { publicError, sdkError } from "./http";
import type { AppContext, ProjectRow } from "../types";

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

export async function requireProjectFromApiKey(c: AppContext) {
  const apiKey = c.req.header("x-wishkit-api-key");

  if (!apiKey) {
    return { ok: false as const, response: sdkError(c, "missingApiHeaderKey", 401) };
  }

  const project = await projectByField(c.env.DB, "api_key", apiKey);
  if (!project) {
    return { ok: false as const, response: sdkError(c, "wrongBearerToken", 401) };
  }

  return { ok: true as const, project };
}

export async function requireProjectBySlug(c: AppContext, slug: string) {
  const project = await projectByField(c.env.DB, "slug", slug);
  if (!project) {
    return { ok: false as const, response: publicError(c, 404, "Project not found.") };
  }

  return { ok: true as const, project };
}

export async function requireAdminProject(c: AppContext, slug: string) {
  const projectResult = await requireProjectBySlug(c, slug);
  if (!projectResult.ok) {
    return projectResult;
  }

  const authHeader = c.req.header("authorization");
  const fallbackHeader = c.req.header("x-openwish-admin-token");
  const adminToken = authHeader?.replace(/^Bearer\s+/i, "").trim() || fallbackHeader;

  if (!adminToken || adminToken !== projectResult.project.admin_token) {
    return { ok: false as const, response: publicError(c, 401, "Admin token is invalid.") };
  }

  return projectResult;
}

export function requireUserUuid(c: AppContext, mode: "sdk" | "public") {
  const candidate =
    c.req.header("x-wishkit-uuid") ?? c.req.header("x-openwish-user-uuid") ?? "";

  if (!candidate) {
    return mode === "sdk"
      ? { ok: false as const, response: sdkError(c, "missingUUIDHeaderKey", 401) }
      : { ok: false as const, response: publicError(c, 401, "User UUID header is required.") };
  }

  if (!uuidPattern.test(candidate)) {
    return mode === "sdk"
      ? { ok: false as const, response: sdkError(c, "missingUUIDHeaderKey", 400) }
      : { ok: false as const, response: publicError(c, 400, "User UUID must be a valid UUID.") };
  }

  return { ok: true as const, uuid: candidate };
}
