import { voteWishRequestSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireProjectFromApiKey, requireUserUuid } from "#/server/auth";
import { toggleVote } from "#/server/db";
import { parseJson, sdkError } from "#/server/http";
import { enforceSdkRateLimit } from "#/server/rate-limit";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/wish/vote")({
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

        const bodyResult = await parseJson(request, voteWishRequestSchema, { errorMode: "sdk" });
        if (!bodyResult.success) {
          return bodyResult.response;
        }

        const response = await toggleVote(
          requestContext.env.DB,
          projectResult.project.id,
          bodyResult.data.wishId,
          userResult.uuid,
        );

        if (!response) {
          return sdkError("unknown", 404);
        }

        return Response.json(response);
      },
    },
  },
});
