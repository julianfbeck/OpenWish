import { projectBootstrapRequestSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireGlobalApiKey } from "#/server/auth";
import { bootstrapProject, loadProjectSummaries } from "#/server/db";
import { parseJson, publicError } from "#/server/http";
import { requireRequestContext } from "#/server/route-context";

// Cross-project programmatic API (v1). Authorized by the single global API key
// (see requireGlobalApiKey), not per-project keys or the dashboard session.
export const Route = createFileRoute("/api/v1/projects")({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const requestContext = requireRequestContext(context);
        const auth = requireGlobalApiKey({ env: requestContext.env, request });
        if (!auth.ok) {
          return auth.response;
        }

        const projects = await loadProjectSummaries(requestContext.env.DB);
        return Response.json({
          projects: projects.map((project) => ({
            slug: project.slug,
            name: project.name,
            appIconUrl: project.appIconUrl,
            createdAt: project.createdAt,
          })),
        });
      },
      POST: async ({ context, request }) => {
        const requestContext = requireRequestContext(context);
        const auth = requireGlobalApiKey({ env: requestContext.env, request });
        if (!auth.ok) {
          return auth.response;
        }

        const body = await parseJson(request, projectBootstrapRequestSchema);
        if (!body.success) {
          return body.response;
        }

        try {
          const created = await bootstrapProject(requestContext.env.DB, {
            name: body.data.name,
            slug: body.data.slug,
            watermarkEnabled: body.data.watermarkEnabled,
          });
          return Response.json(created, { status: 201 });
        } catch {
          return publicError(409, "A project with that slug already exists.");
        }
      },
    },
  },
});
