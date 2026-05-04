import { createFileRoute } from "@tanstack/react-router";

import { requireAdminProject } from "#/server/auth";
import { deleteProject, loadAdminProject } from "#/server/db";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/admin/projects/$slug")({
  server: {
    handlers: {
      GET: async ({ context, params, request }) => {
        const requestContext = requireRequestContext(context);
        const projectResult = await requireAdminProject(
          {
            env: requestContext.env,
            request,
          },
          params.slug,
        );

        if (!projectResult.ok) {
          return projectResult.response;
        }

        const response = await loadAdminProject(requestContext.env.DB, projectResult.project);
        return Response.json(response);
      },
      DELETE: async ({ context, params, request }) => {
        const requestContext = requireRequestContext(context);
        const projectResult = await requireAdminProject(
          {
            env: requestContext.env,
            request,
          },
          params.slug,
        );

        if (!projectResult.ok) {
          return projectResult.response;
        }

        await deleteProject(requestContext.env.DB, projectResult.project.slug);
        return new Response(null, { status: 204 });
      },
    },
  },
});
