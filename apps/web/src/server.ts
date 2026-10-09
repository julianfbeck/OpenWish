import { defaultStreamHandler } from "@tanstack/react-start/server";
import { createStartHandler } from "@tanstack/react-start/server";

import type { Bindings, ServerRequestContext } from "#/server/types";
import { handleOpenWishMcpRequest } from "#/server/mcp";
import { requireMcpBearer } from "#/server/auth";
import { handleOpenWishOAuthRequest, isOpenWishOAuthPath } from "#/server/oauth";

export { OpenWishOAuthState } from "#/server/oauth";

const handleRequest = createStartHandler({
  handler: defaultStreamHandler,
});

export function fetchWithContext(
  request: Request,
  env?: Bindings,
  executionContext?: ExecutionContext,
) {
  if (env) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/mcp") {
      // Preserve the existing global credential path, including installations
      // that have not enabled OAuth. OAuth tokens never enter REST API auth.
      if (requireMcpBearer({ env, request }).ok || !env.MCP_OAUTH_STATE || !env.OPENWISH_MCP_OAUTH_ORIGIN) {
        return handleOpenWishMcpRequest(request, env, executionContext);
      }
      return handleOpenWishOAuthRequest(request, env);
    }
    if (isOpenWishOAuthPath(pathname)) {
      return handleOpenWishOAuthRequest(request, env);
    }
  }

  const context: ServerRequestContext | undefined = env
    ? {
        env,
        executionContext,
      }
    : undefined;

  return (
    handleRequest as (
      nextRequest: Request,
      opts?: {
        context?: ServerRequestContext;
      },
    ) => Promise<Response>
  )(request, context ? { context } : undefined);
}

export default {
  async fetch(request: Request, env: Bindings, executionContext: ExecutionContext) {
    return fetchWithContext(request, env, executionContext);
  },
};
