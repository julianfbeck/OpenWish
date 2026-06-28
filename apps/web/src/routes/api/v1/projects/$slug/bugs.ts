import { createBugRequestSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireGlobalApiKey, requireProjectBySlug } from "#/server/auth";
import { createBug, loadAdminBugs } from "#/server/db";
import { parseJson } from "#/server/http";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/v1/projects/$slug/bugs")({
  server: {
    handlers: {
      GET: async ({ context, params, request }) => {
        const requestContext = requireRequestContext(context);
        const auth = requireGlobalApiKey({ env: requestContext.env, request });
        if (!auth.ok) {
          return auth.response;
        }

        const projectResult = await requireProjectBySlug(
          { env: requestContext.env },
          params.slug,
        );
        if (!projectResult.ok) {
          return projectResult.response;
        }

        const list = await loadAdminBugs(requestContext.env.DB, projectResult.project);
        return Response.json({ list });
      },
      POST: async ({ context, params, request }) => {
        const requestContext = requireRequestContext(context);
        const auth = requireGlobalApiKey({ env: requestContext.env, request });
        if (!auth.ok) {
          return auth.response;
        }

        const projectResult = await requireProjectBySlug(
          { env: requestContext.env },
          params.slug,
        );
        if (!projectResult.ok) {
          return projectResult.response;
        }

        const body = await parseJson(request, createBugRequestSchema);
        if (!body.success) {
          return body.response;
        }

        const created = await createBug(
          requestContext.env.DB,
          projectResult.project,
          crypto.randomUUID(),
          body.data,
        );
        return Response.json(created, { status: 201 });
      },
    },
  },
});
