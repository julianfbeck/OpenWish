import { createFileRoute } from "@tanstack/react-router";

import { requireDashboardSession } from "#/server/auth";
import { listPasskeys } from "#/server/passkeys";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/auth/passkey/")({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const requestContext = requireRequestContext(context);
        const session = await requireDashboardSession({
          env: requestContext.env,
          request,
        });
        if (!session.ok) {
          return session.response;
        }
        const list = await listPasskeys(requestContext.env.DB, session.session.username);
        return Response.json({ list });
      },
    },
  },
});
