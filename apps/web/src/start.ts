import { createMiddleware, createStart } from "@tanstack/react-start";

import { applyCorsHeaders, isApiRequest, preflightResponse } from "#/server/api";
import { ensureDatabaseInitialized } from "#/server/db";
import type { ServerRequestContext } from "#/server/types";

const requestContextMiddleware = createMiddleware().server(async ({ context, next, pathname, request }) => {
  const requestContext = context as ServerRequestContext | undefined;

  if (!requestContext?.env) {
    throw new Error("OpenWish request context is missing Cloudflare bindings.");
  }

  await ensureDatabaseInitialized(requestContext.env.DB);

  if (request.method === "OPTIONS" && isApiRequest(pathname)) {
    return preflightResponse(requestContext.env);
  }

  const result = await next({
    context: requestContext,
  });

  if (isApiRequest(pathname)) {
    applyCorsHeaders(result.response, requestContext.env);
  }

  return result;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [requestContextMiddleware],
}));
