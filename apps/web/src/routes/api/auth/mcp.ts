import { createFileRoute } from "@tanstack/react-router";

import { requireDashboardSession } from "#/server/auth";
import { publicError } from "#/server/http";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/auth/mcp")({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const requestContext = requireRequestContext(context);
        const session = await requireDashboardSession({ env: requestContext.env, request });
        if (!session.ok) return session.response;

        const token = requestContext.env.OPENWISH_GLOBAL_API_KEY?.trim();
        if (!token) return publicError(503, "OpenWish MCP is not configured.");

        return Response.json(
          {
            endpoint: `${new URL(request.url).origin}/mcp`,
            token,
            authorization: "Bearer",
          },
          {
            headers: {
              "Cache-Control": "no-store, private",
              "Referrer-Policy": "no-referrer",
            },
          },
        );
      },
    },
  },
});
