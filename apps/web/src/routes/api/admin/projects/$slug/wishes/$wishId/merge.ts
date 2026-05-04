import { adminWishMergeSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireAdminProject } from "#/server/auth";
import { loadAdminProject, mergeWish } from "#/server/db";
import { parseJson, publicError } from "#/server/http";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/admin/projects/$slug/wishes/$wishId/merge")({
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

        const bodyResult = await parseJson(request, adminWishMergeSchema);
        if (!bodyResult.success) {
          return bodyResult.response;
        }

        const merged = await mergeWish(
          requestContext.env.DB,
          projectResult.project.id,
          params.wishId,
          bodyResult.data.targetWishId,
        );

        if (!merged) {
          return publicError(404, "Wish not found.");
        }

        const response = await loadAdminProject(requestContext.env.DB, projectResult.project);
        return Response.json(response);
      },
    },
  },
});
