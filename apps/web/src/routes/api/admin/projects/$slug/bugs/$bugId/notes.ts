import { createFileRoute } from "@tanstack/react-router";

import { requireAdminProject } from "#/server/auth";
import { loadIssueNotes } from "#/server/db";
import { requireRequestContext } from "#/server/route-context";

// Private maintainer notes (MCP notes and AI triage) for the dashboard. Never
// part of any SDK response.
export const Route = createFileRoute("/api/admin/projects/$slug/bugs/$bugId/notes")({
  server: {
    handlers: {
      GET: async ({ context, params, request }) => {
        const requestContext = requireRequestContext(context);
        const projectResult = await requireAdminProject({ env: requestContext.env, request }, params.slug);
        if (!projectResult.ok) return projectResult.response;
        return Response.json({
          list: await loadIssueNotes(requestContext.env.DB, projectResult.project.id, params.bugId),
        });
      },
    },
  },
});
