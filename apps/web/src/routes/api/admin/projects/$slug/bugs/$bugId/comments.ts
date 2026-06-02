import { createBugCommentRequestSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireAdminProject } from "#/server/auth";
import {
  createBugComment,
  getBugMeta,
  getReporterContact,
  loadAdminBugs,
} from "#/server/db";
import { parseJson, publicError } from "#/server/http";
import { notifyReporter } from "#/server/reporter-notify";
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

        // Notify the bug's reporter that an admin replied.
        const meta = await getBugMeta(
          requestContext.env.DB,
          projectResult.project.id,
          params.bugId,
        );
        if (meta) {
          const contact = await getReporterContact(
            requestContext.env.DB,
            projectResult.project.id,
            meta.userUuid,
          );
          await notifyReporter(requestContext, projectResult.project, {
            event: "comment",
            kind: "bug",
            userUuid: meta.userUuid,
            title: meta.title,
            to: meta.reporterEmail ?? contact.email,
            unsubscribed: contact.unsubscribed,
            comment: bodyResult.data.description,
          });
        }

        const list = await loadAdminBugs(requestContext.env.DB, projectResult.project);
        return Response.json({ list }, { status: 201 });
      },
    },
  },
});
