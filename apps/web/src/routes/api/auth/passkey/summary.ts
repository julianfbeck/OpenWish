import { createFileRoute } from "@tanstack/react-router";

import { hasAnyPasskey } from "#/server/passkeys";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/auth/passkey/summary")({
  server: {
    handlers: {
      GET: async ({ context }) => {
        const requestContext = requireRequestContext(context);
        const hasPasskey = await hasAnyPasskey(requestContext.env.DB);
        return Response.json({ hasPasskey });
      },
    },
  },
});
