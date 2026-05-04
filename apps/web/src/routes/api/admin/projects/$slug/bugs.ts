import { createFileRoute } from "@tanstack/react-router";

import { requireAdminProject } from "#/server/auth";
import { loadAdminBugs } from "#/server/db";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/admin/projects/$slug/bugs")({
  server: {
    handlers: {
      GET: async ({ context, params, request }) => {
        const requestContext = requireRequestContext(context);
        const projectResult = await requireAdminProject(
          { env: requestContext.env, request },
          params.slug,
        );

        if (!projectResult.ok) {
          return projectResult.response;
        }

        const list = await loadAdminBugs(requestContext.env.DB, projectResult.project);
        return Response.json({ list });
      },
    },
  },
});
