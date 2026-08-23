import { createFileRoute } from "@tanstack/react-router";

import { requireProjectFromApiKey, requireUserUuid } from "#/server/auth";
import { ensureUserExists, loadWishesForProject, recordAnalyticsEvent } from "#/server/db";
import { enforceSdkRateLimit } from "#/server/rate-limit";
import { requireRequestContext } from "#/server/route-context";

// V2 deliberately returns the proven WishKit list shape. New SDKs can move to
// the versioned URL without making existing models or live V1 routes brittle.
export const Route = createFileRoute("/api/v2/features")({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const requestContext = requireRequestContext(context);
        const projectResult = await requireProjectFromApiKey({ env: requestContext.env, request });
        if (!projectResult.ok) return projectResult.response;
        const userResult = requireUserUuid(request, "sdk");
        if (!userResult.ok) return userResult.response;
        const limit = await enforceSdkRateLimit({
          env: requestContext.env,
          apiKey: projectResult.project.api_key,
          userUuid: userResult.uuid,
          kind: "read",
        });
        if (!limit.ok) return limit.response;

        await Promise.all([
          ensureUserExists(requestContext.env.DB, projectResult.project.id, userResult.uuid),
          recordAnalyticsEvent(requestContext.env.DB, projectResult.project.id, "view"),
        ]);
        return Response.json(
          await loadWishesForProject(
            requestContext.env.DB,
            projectResult.project,
            userResult.uuid,
          ),
        );
      },
    },
  },
});
