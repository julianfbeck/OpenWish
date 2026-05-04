import { createFileRoute } from "@tanstack/react-router";

import { serializeDashboardLogoutCookie } from "#/server/dashboardAuth";

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        Response.json(
          {
            authenticated: false,
            username: "",
          },
          {
            headers: {
              "Set-Cookie": serializeDashboardLogoutCookie(request),
            },
          },
        ),
    },
  },
});
