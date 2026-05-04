import { createCommentRequestSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireProjectFromApiKey, requireUserUuid } from "#/server/auth";
import { createComment } from "#/server/db";
import { parseJson, sdkError } from "#/server/http";
import { enforceSdkRateLimit } from "#/server/rate-limit";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/comment/create")({
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
          kind: "write",
        });
        if (!limit.ok) {
          return limit.response;
        }

        const bodyResult = await parseJson(request, createCommentRequestSchema, {
          errorMode: "sdk",
        });
        if (!bodyResult.success) {
          return bodyResult.response;
        }

        const response = await createComment(
          requestContext.env.DB,
          projectResult.project.id,
          bodyResult.data.wishId,
          userResult.uuid,
          bodyResult.data.description,
          false,
        );

        if (!response) {
          return sdkError("unknown", 404);
        }

        return Response.json(response);
      },
    },
  },
});
