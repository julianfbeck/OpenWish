import { createFileRoute } from "@tanstack/react-router";

import { requireProjectFromApiKey } from "#/server/auth";
import { loadWishesForProject } from "#/server/db";
import { enforceSdkRateLimit } from "#/server/rate-limit";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/wish/list")({
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

        const limit = await enforceSdkRateLimit({
          env: requestContext.env,
          apiKey: projectResult.project.api_key,
          userUuid: request.headers.get("x-wishkit-uuid") ?? "anon",
          kind: "read",
        });
        if (!limit.ok) {
          return limit.response;
        }

        const response = await loadWishesForProject(requestContext.env.DB, projectResult.project);
        return Response.json(response);
      },
    },
  },
});
