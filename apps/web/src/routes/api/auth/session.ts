import { dashboardSessionResponseSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireDashboardSession } from "#/server/auth";
import {
  createDashboardSessionToken,
  serializeDashboardSessionCookie,
} from "#/server/dashboardAuth";
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

        const body = dashboardSessionResponseSchema.parse({
          authenticated: true,
          username: sessionResult.session.username,
        });

        // Sliding session: every authenticated dashboard load (the SPA hits this
        // route on mount) refreshes the cookie so an active admin never gets
        // logged out within the lifetime window.
        const refreshed = await createDashboardSessionToken(
          requestContext.env,
          sessionResult.session.username,
        );
        if (!refreshed) {
          return Response.json(body);
        }

        return Response.json(body, {
          headers: {
            "Set-Cookie": serializeDashboardSessionCookie(
              request,
              refreshed,
              requestContext.env,
            ),
          },
        });
      },
    },
  },
});
