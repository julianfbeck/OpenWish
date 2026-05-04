import { adminBugUpdateSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireAdminProject } from "#/server/auth";
import { deleteBug, loadAdminBugs, updateBug } from "#/server/db";
import { parseJson, publicError } from "#/server/http";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/admin/projects/$slug/bugs/$bugId")({
  server: {
    handlers: {
      PATCH: async ({ context, params, request }) => {
        const requestContext = requireRequestContext(context);
        const projectResult = await requireAdminProject(
          { env: requestContext.env, request },
          params.slug,
        );

        if (!projectResult.ok) {
          return projectResult.response;
        }

        const bodyResult = await parseJson(request, adminBugUpdateSchema);
        if (!bodyResult.success) {
          return bodyResult.response;
        }

        const updated = await updateBug(
          requestContext.env.DB,
          projectResult.project,
          params.bugId,
          bodyResult.data,
        );

        if (!updated) {
          return publicError(404, "Bug not found.");
        }

        const list = await loadAdminBugs(requestContext.env.DB, projectResult.project);
        return Response.json({ list });
      },
      DELETE: async ({ context, params, request }) => {
        const requestContext = requireRequestContext(context);
        const projectResult = await requireAdminProject(
          { env: requestContext.env, request },
          params.slug,
        );

        if (!projectResult.ok) {
          return projectResult.response;
        }

        const result = await deleteBug(
          requestContext.env.DB,
          requestContext.env.BUGS_BUCKET,
          projectResult.project,
          params.bugId,
        );

        if (!result.deleted) {
          return publicError(404, "Bug not found.");
        }

        const list = await loadAdminBugs(requestContext.env.DB, projectResult.project);
        return Response.json({ list });
      },
    },
  },
});
