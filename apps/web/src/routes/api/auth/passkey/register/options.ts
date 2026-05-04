import { createFileRoute } from "@tanstack/react-router";

import { requireDashboardSession } from "#/server/auth";
import { publicError } from "#/server/http";
import { buildRegistrationOptions } from "#/server/passkeys";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/auth/passkey/register/options")({
  server: {
    handlers: {
      POST: async ({ context, request }) => {
        const requestContext = requireRequestContext(context);
        const session = await requireDashboardSession({
          env: requestContext.env,
          request,
        });
        if (!session.ok) {
          return session.response;
        }

        if (!requestContext.env.OPENWISH_PASSKEY_RP_ID) {
          return publicError(503, "Passkey support is not configured.");
        }

        const options = await buildRegistrationOptions(
          requestContext.env,
          session.session.username,
        );
        return Response.json(options);
      },
    },
  },
});
