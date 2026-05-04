import { createFileRoute } from "@tanstack/react-router";

import { requireProjectFromApiKey, requireUserUuid } from "#/server/auth";
import {
  ALLOWED_SCREENSHOT_TYPES,
  MAX_SCREENSHOT_BYTES,
  isAllowedScreenshotType,
  screenshotKeyFor,
} from "#/server/bug-constants";
import { enforceSdkRateLimit } from "#/server/rate-limit";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/bug/screenshot")({
  server: {
    handlers: {
      POST: async ({ context, request }) => {
        const requestContext = requireRequestContext(context);
        const projectResult = await requireProjectFromApiKey({
          env: requestContext.env,
          request,
        });

        if (!projectResult.ok) {
          return projectResult.response;
        }

        const userResult = requireUserUuid(request, "sdk");
        if (!userResult.ok) {
          return userResult.response;
        }

        const limit = await enforceSdkRateLimit({
          env: requestContext.env,
          apiKey: projectResult.project.api_key,
          userUuid: userResult.uuid,
          kind: "screenshot",
        });
        if (!limit.ok) {
          return limit.response;
        }

        const contentType = (request.headers.get("content-type") ?? "")
          .split(";", 1)[0]
          .trim()
          .toLowerCase();

        if (!isAllowedScreenshotType(contentType)) {
          return Response.json(
            {
              reason: "couldNotCreateRequest",
              detail: `content-type must be one of ${ALLOWED_SCREENSHOT_TYPES.join(", ")}`,
            },
            { status: 400 },
          );
        }

        const buffer = await request.arrayBuffer();
        if (buffer.byteLength === 0) {
          return Response.json({ reason: "couldNotCreateRequest" }, { status: 400 });
        }

        if (buffer.byteLength > MAX_SCREENSHOT_BYTES) {
          return Response.json({ reason: "couldNotCreateRequest" }, { status: 413 });
        }

        const key = screenshotKeyFor(projectResult.project.id, contentType);

        await requestContext.env.BUGS_BUCKET.put(key, buffer, {
          httpMetadata: { contentType },
        });

        return Response.json({ key });
      },
    },
  },
});
