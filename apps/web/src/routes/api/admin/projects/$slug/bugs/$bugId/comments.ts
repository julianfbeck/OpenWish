import { createBugCommentRequestSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireAdminProject } from "#/server/auth";
import { createBugComment, loadAdminBugs } from "#/server/db";
import { parseJson, publicError } from "#/server/http";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/admin/projects/$slug/bugs/$bugId/comments")({
  server: {
    handlers: {
      POST: async ({ context, params, request }) => {
        const requestContext = requireRequestContext(context);
        const projectResult = await requireAdminProject(
          { env: requestContext.env, request },
          params.slug,
        );

        if (!projectResult.ok) {
          return projectResult.response;
        }

        const bodyResult = await parseJson(request, createBugCommentRequestSchema);
        if (!bodyResult.success) {
          return bodyResult.response;
        }

        const updated = await createBugComment(
          requestContext.env.DB,
          projectResult.project,
          params.bugId,
          crypto.randomUUID(),
          bodyResult.data.description,
          true,
        );

        if (!updated) {
          return publicError(404, "Bug not found.");
        }

        const list = await loadAdminBugs(requestContext.env.DB, projectResult.project);
        return Response.json({ list }, { status: 201 });
      },
    },
  },
});
