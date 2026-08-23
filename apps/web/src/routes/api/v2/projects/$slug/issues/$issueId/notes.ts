import { createIssueNoteRequestSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireGlobalApiKey, requireProjectBySlug } from "#/server/auth";
import { createIssueNote, loadIssueNotes } from "#/server/db";
import { parseJson, publicError } from "#/server/http";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/v2/projects/$slug/issues/$issueId/notes")({
  server: {
    handlers: {
      GET: async ({ context, params, request }) => {
        const requestContext = requireRequestContext(context);
        const auth = requireGlobalApiKey({ env: requestContext.env, request });
        if (!auth.ok) return auth.response;
        const project = await requireProjectBySlug({ env: requestContext.env }, params.slug);
        if (!project.ok) return project.response;
        return Response.json({
          list: await loadIssueNotes(requestContext.env.DB, project.project.id, params.issueId),
        });
      },
      POST: async ({ context, params, request }) => {
        const requestContext = requireRequestContext(context);
        const auth = requireGlobalApiKey({ env: requestContext.env, request });
        if (!auth.ok) return auth.response;
        const project = await requireProjectBySlug({ env: requestContext.env }, params.slug);
        if (!project.ok) return project.response;
        const body = await parseJson(request, createIssueNoteRequestSchema);
        if (!body.success) return body.response;
        const note = await createIssueNote(
          requestContext.env.DB, project.project.id, params.issueId, body.data.body,
        );
        return note ? Response.json(note, { status: 201 }) : publicError(404, "Issue not found.");
      },
    },
  },
});
