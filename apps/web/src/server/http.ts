import { apiErrorReasonSchema, type ApiErrorReason } from "@openwish/shared";
import { z } from "zod";

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 503;

export function sdkError(reason: ApiErrorReason, status: ErrorStatus = 400) {
  return Response.json({ reason: apiErrorReasonSchema.parse(reason) }, { status });
}

export function publicError(status: ErrorStatus, message: string) {
  return Response.json({ error: message }, { status });
}

type ParseJsonOptions =
  | {
      errorMode?: "public";
    }
  | {
      errorMode: "sdk";
      sdkReason?: ApiErrorReason;
    };

export async function parseJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  options: ParseJsonOptions = { errorMode: "public" },
): Promise<{ success: true; data: T } | { success: false; response: Response }> {
  const errorResponse = (message: string) => {
    if (options.errorMode === "sdk") {
      return sdkError(options.sdkReason ?? "unknown", 400);
    }

    return publicError(400, message);
  };

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return {
      success: false,
      response: errorResponse("Request body must be valid JSON."),
    };
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    return {
      success: false,
      response: errorResponse(result.error.issues[0]?.message ?? "Invalid request body."),
    };
  }

  return { success: true, data: result.data };
}
