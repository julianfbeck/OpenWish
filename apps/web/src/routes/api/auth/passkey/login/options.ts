import { createFileRoute } from "@tanstack/react-router";

import { dashboardAuthConfigured } from "#/server/dashboardAuth";
import { publicError } from "#/server/http";
import { buildAuthenticationOptions } from "#/server/passkeys";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/auth/passkey/login/options")({
  server: {
    handlers: {
      POST: async ({ context }) => {
        const requestContext = requireRequestContext(context);
        if (!dashboardAuthConfigured(requestContext.env)) {
          return publicError(503, "Dashboard login is not configured.");
        }

        const username = requestContext.env.OPENWISH_DASHBOARD_USERNAME ?? "admin";
        const options = await buildAuthenticationOptions(requestContext.env, username);
        return Response.json(options);
      },
    },
  },
});
