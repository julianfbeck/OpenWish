import { defaultStreamHandler } from "@tanstack/react-start/server";
import { createStartHandler } from "@tanstack/react-start/server";

import type { Bindings, ServerRequestContext } from "#/server/types";
import { handleOpenWishMcpRequest } from "#/server/mcp";

const handleRequest = createStartHandler({
  handler: defaultStreamHandler,
});

export function fetchWithContext(
  request: Request,
  env?: Bindings,
  executionContext?: ExecutionContext,
) {
  if (env && new URL(request.url).pathname === "/mcp") {
    return handleOpenWishMcpRequest(request, env, executionContext);
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
