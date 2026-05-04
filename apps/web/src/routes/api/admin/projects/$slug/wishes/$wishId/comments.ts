import { adminCommentRequestSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireAdminProject } from "#/server/auth";
import { createComment, loadAdminProject } from "#/server/db";
import { parseJson, publicError } from "#/server/http";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/admin/projects/$slug/wishes/$wishId/comments")({
  server: {
    handlers: {
      POST: async ({ context, params, request }) => {
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

        const bodyResult = await parseJson(request, adminCommentRequestSchema);
        if (!bodyResult.success) {
          return bodyResult.response;
        }

        const comment = await createComment(
          requestContext.env.DB,
          projectResult.project.id,
          params.wishId,
          crypto.randomUUID(),
          bodyResult.data.description,
          true,
        );

        if (!comment) {
          return publicError(404, "Wish not found.");
        }

        const response = await loadAdminProject(requestContext.env.DB, projectResult.project);
        return Response.json(response, { status: 201 });
      },
    },
  },
});
