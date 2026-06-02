import { adminCommentRequestSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireAdminProject } from "#/server/auth";
import {
  createComment,
  getReporterContact,
  getWishMeta,
  loadAdminProject,
} from "#/server/db";
import { parseJson, publicError } from "#/server/http";
import { notifyReporter } from "#/server/reporter-notify";
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

        // Notify the wish's reporter that an admin replied.
        const meta = await getWishMeta(
          requestContext.env.DB,
          projectResult.project.id,
          params.wishId,
        );
        if (meta) {
          const contact = await getReporterContact(
            requestContext.env.DB,
            projectResult.project.id,
            meta.userUuid,
          );
          await notifyReporter(requestContext, projectResult.project, {
            event: "comment",
            kind: "wish",
            userUuid: meta.userUuid,
            title: meta.title,
            to: contact.email,
            unsubscribed: contact.unsubscribed,
            comment: bodyResult.data.description,
          });
        }

        const response = await loadAdminProject(requestContext.env.DB, projectResult.project);
        return Response.json(response, { status: 201 });
      },
    },
  },
});
