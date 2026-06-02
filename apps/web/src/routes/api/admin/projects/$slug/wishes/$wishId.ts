import { adminWishUpdateSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireAdminProject } from "#/server/auth";
import {
  deleteWish,
  getReporterContact,
  getWishMeta,
  loadAdminProject,
  updateWish,
} from "#/server/db";
import { parseJson, publicError } from "#/server/http";
import { notifyReporter } from "#/server/reporter-notify";
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

        const before = await getWishMeta(
          requestContext.env.DB,
          projectResult.project.id,
          params.wishId,
        );

        await updateWish(
          requestContext.env.DB,
          projectResult.project.id,
          params.wishId,
          bodyResult.data,
        );

        // Email the reporter only on a real transition into "implemented".
        if (
          before &&
          bodyResult.data.state === "implemented" &&
          before.state !== "implemented"
        ) {
          const contact = await getReporterContact(
            requestContext.env.DB,
            projectResult.project.id,
            before.userUuid,
          );
          await notifyReporter(requestContext, projectResult.project, {
            event: "resolved",
            kind: "wish",
            userUuid: before.userUuid,
            title: before.title,
            to: contact.email,
            unsubscribed: contact.unsubscribed,
          });
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
