import type { Bindings } from "./types";

const allowedHeaders = [
  "Content-Type",
  "Authorization",
  "x-openwish-admin-token",
  "x-openwish-bootstrap-token",
  "x-openwish-user-uuid",
  "x-wishkit-api-key",
  "x-wishkit-uuid",
].join(", ");

const allowedMethods = ["GET", "POST", "PATCH", "DELETE", "OPTIONS", "HEAD"].join(", ");

export function isApiRequest(pathname: string) {
  return pathname === "/health" || pathname.startsWith("/api/");
}

export function buildCorsHeaders(env: Bindings) {
  return {
    "Access-Control-Allow-Origin": env.OPENWISH_CORS_ORIGIN ?? "*",
    "Access-Control-Allow-Headers": allowedHeaders,
    "Access-Control-Allow-Methods": allowedMethods,
  };
}

export function applyCorsHeaders(response: Response, env: Bindings) {
  const headers = buildCorsHeaders(env);

  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }

  return response;
}

export function preflightResponse(env: Bindings) {
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(env),
  });
}
