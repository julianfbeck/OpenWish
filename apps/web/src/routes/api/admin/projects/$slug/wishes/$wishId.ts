import { adminWishUpdateSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireAdminProject } from "#/server/auth";
import { deleteWish, loadAdminProject, updateWish } from "#/server/db";
import { parseJson, publicError } from "#/server/http";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/admin/projects/$slug/wishes/$wishId")({
  server: {
    handlers: {
      PATCH: async ({ context, params, request }) => {
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

        const bodyResult = await parseJson(request, adminWishUpdateSchema);
        if (!bodyResult.success) {
          return bodyResult.response;
        }

        await updateWish(
          requestContext.env.DB,
          projectResult.project.id,
          params.wishId,
          bodyResult.data,
        );

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

        const deleted = await deleteWish(requestContext.env.DB, projectResult.project.id, params.wishId);
        if (!deleted) {
          return publicError(404, "Wish not found.");
        }

        const response = await loadAdminProject(requestContext.env.DB, projectResult.project);
        return Response.json(response);
      },
    },
  },
});
