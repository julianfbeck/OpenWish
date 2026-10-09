/** OAuth grants are bounded to existing immutable project IDs. API keys retain full access. */
export type McpAccess = {
  mode: "oauth";
  subject: string;
  projectIds: string[];
  scopes: string[];
};

export const mcpScopes = ["mcp:read", "mcp:write", "mcp:admin"] as const;

/** Stable opaque owner identifier shared by consent issuance and MCP checks. */
export async function dashboardMcpSubject(username: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(username.trim())));
  return `dashboard-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function mcpScopeFor(annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }) {
  return annotations?.readOnlyHint ? "mcp:read"
    : annotations?.destructiveHint ? "mcp:admin"
    : "mcp:write";
}

export function mcpResource(env: { OPENWISH_MCP_OAUTH_ORIGIN?: string }, _request: Request) {
  try {
    return new URL("/mcp", env.OPENWISH_MCP_OAUTH_ORIGIN ?? "https://wishkit.juli.sh").href;
  } catch {
    return "https://wishkit.juli.sh/mcp";
  }
}

export function mcpAuthChallenge(resource: string, scopes: string[], description: string) {
  const origin = new URL(resource).origin;
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", error_description="${description}", scope="${scopes.join(" ")}"`;
}
