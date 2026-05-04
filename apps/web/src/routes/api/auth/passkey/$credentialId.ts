import { createFileRoute } from "@tanstack/react-router";

import { requireDashboardSession } from "#/server/auth";
import { publicError } from "#/server/http";
import { deletePasskey } from "#/server/passkeys";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/auth/passkey/$credentialId")({
  server: {
    handlers: {
      DELETE: async ({ context, params, request }) => {
        const requestContext = requireRequestContext(context);
        const session = await requireDashboardSession({
          env: requestContext.env,
          request,
        });
        if (!session.ok) {
          return session.response;
        }

        const removed = await deletePasskey(
          requestContext.env.DB,
          session.session.username,
          params.credentialId,
        );

        if (!removed) {
          return publicError(404, "Passkey not found.");
        }

        return Response.json({ ok: true });
      },
    },
  },
});
