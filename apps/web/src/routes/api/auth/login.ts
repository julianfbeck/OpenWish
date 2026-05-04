import { dashboardLoginRequestSchema, dashboardSessionResponseSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import {
  authenticateDashboardCredentials,
  dashboardAuthConfigured,
  serializeDashboardSessionCookie,
} from "#/server/dashboardAuth";
import { parseJson, publicError } from "#/server/http";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      POST: async ({ context, request }) => {
        const requestContext = requireRequestContext(context);

        if (!dashboardAuthConfigured(requestContext.env)) {
          return publicError(503, "Dashboard login is not configured.");
        }

        const bodyResult = await parseJson(request, dashboardLoginRequestSchema);
        if (!bodyResult.success) {
          return bodyResult.response;
        }

        const result = await authenticateDashboardCredentials(
          requestContext.env,
          bodyResult.data.username,
          bodyResult.data.password,
        );

        if (!result.ok) {
          return publicError(401, result.reason);
        }

        return Response.json(
          dashboardSessionResponseSchema.parse({
            authenticated: true,
            username: result.username,
          }),
          {
            headers: {
              "Set-Cookie": serializeDashboardSessionCookie(request, result.token),
            },
          },
        );
      },
    },
  },
});
