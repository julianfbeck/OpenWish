import { userRequestSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireProjectFromApiKey, requireUserUuid } from "#/server/auth";
import { upsertUser } from "#/server/db";
import { parseJson } from "#/server/http";
import { enforceSdkRateLimit } from "#/server/rate-limit";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/user/update")({
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

        const bodyResult = await parseJson(request, userRequestSchema, { errorMode: "sdk" });
        if (!bodyResult.success) {
          return bodyResult.response;
        }

        const response = await upsertUser(
          requestContext.env.DB,
          projectResult.project.id,
          userResult.uuid,
          bodyResult.data,
        );

        return Response.json(response);
      },
    },
  },
});
