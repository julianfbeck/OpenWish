import type { AuthenticationResponseJSON } from "@simplewebauthn/types";
import {
  dashboardSessionResponseSchema,
  passkeyLoginVerifyRequestSchema,
} from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import {
  createDashboardSessionToken,
  dashboardAuthConfigured,
  serializeDashboardSessionCookie,
} from "#/server/dashboardAuth";
import { parseJson, publicError } from "#/server/http";
import { verifyAuthentication } from "#/server/passkeys";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/auth/passkey/login/verify")({
  server: {
    handlers: {
      POST: async ({ context, request }) => {
        const requestContext = requireRequestContext(context);
        if (!dashboardAuthConfigured(requestContext.env)) {
          return publicError(503, "Dashboard login is not configured.");
        }

        const bodyResult = await parseJson(request, passkeyLoginVerifyRequestSchema);
        if (!bodyResult.success) {
          return bodyResult.response;
        }

        const username = requestContext.env.OPENWISH_DASHBOARD_USERNAME ?? "admin";
        const result = await verifyAuthentication(
          requestContext.env,
          username,
          bodyResult.data.assertion as AuthenticationResponseJSON,
        );
        if (!result.ok) {
          return publicError(401, result.reason);
        }

        const token = await createDashboardSessionToken(requestContext.env, username);
        if (!token) {
          return publicError(503, "Could not issue session token.");
        }

        return Response.json(
          dashboardSessionResponseSchema.parse({
            authenticated: true,
            username,
          }),
          {
            headers: {
              "Set-Cookie": serializeDashboardSessionCookie(request, token),
            },
          },
        );
      },
    },
  },
});
