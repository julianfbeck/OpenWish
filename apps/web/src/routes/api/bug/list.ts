import { createFileRoute } from "@tanstack/react-router";

import { requireProjectFromApiKey, requireUserUuid } from "#/server/auth";
import { loadUserBugs } from "#/server/db";
import { enforceSdkRateLimit } from "#/server/rate-limit";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/bug/list")({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
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
          kind: "read",
        });
        if (!limit.ok) {
          return limit.response;
        }

        const list = await loadUserBugs(
          requestContext.env.DB,
          projectResult.project,
          userResult.uuid,
        );

        return Response.json({ list });
      },
    },
  },
});
