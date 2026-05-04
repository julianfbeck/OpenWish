import type { ServerRequestContext } from "./types";

export function requireRequestContext(context: unknown): ServerRequestContext {
  const requestContext = context as ServerRequestContext | undefined;

  if (!requestContext?.env) {
    throw new Error("OpenWish request context is unavailable.");
  }

  return requestContext;
}
