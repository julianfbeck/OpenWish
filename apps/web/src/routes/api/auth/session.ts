import { dashboardSessionResponseSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireDashboardSession } from "#/server/auth";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/auth/session")({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const requestContext = requireRequestContext(context);
        const sessionResult = await requireDashboardSession({
          env: requestContext.env,
          request,
        });

        if (!sessionResult.ok) {
          return sessionResult.response;
        }

        return Response.json(
          dashboardSessionResponseSchema.parse({
            authenticated: true,
            username: sessionResult.session.username,
          }),
        );
      },
    },
  },
});
