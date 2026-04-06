import { apiErrorReasonSchema, type ApiErrorReason } from "@openwish/shared";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { AppContext } from "../types";

type ErrorStatus = Extract<ContentfulStatusCode, 400 | 401 | 404 | 409>;

export function sdkError(c: AppContext, reason: ApiErrorReason, status: ErrorStatus = 400) {
  return c.json({ reason: apiErrorReasonSchema.parse(reason) }, { status });
}

export function publicError(c: AppContext, status: ErrorStatus, message: string) {
  return c.json({ error: message }, { status });
}

export async function parseJson<T>(
  c: AppContext,
  schema: z.ZodType<T>,
): Promise<{ success: true; data: T } | { success: false; response: Response }> {
  let payload: unknown;

  try {
    payload = await c.req.json();
  } catch {
    return {
      success: false,
      response: publicError(c, 400, "Request body must be valid JSON."),
    };
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    return {
      success: false,
      response: publicError(c, 400, result.error.issues[0]?.message ?? "Invalid request body."),
    };
  }

  return { success: true, data: result.data };
}
