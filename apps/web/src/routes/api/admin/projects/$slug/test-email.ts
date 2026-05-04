import { adminTestEmailRequestSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireAdminProject } from "#/server/auth";
import { parseJson, publicError } from "#/server/http";
import { requireRequestContext } from "#/server/route-context";
import { sendTestEmail } from "#/server/notifications";

export const Route = createFileRoute("/api/admin/projects/$slug/test-email")({
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

        const bodyResult = await parseJson(request, adminTestEmailRequestSchema);
        if (!bodyResult.success) {
          return bodyResult.response;
        }

        try {
          await sendTestEmail(requestContext.env, bodyResult.data.to, projectResult.project);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not send email.";
          return publicError(500, message);
        }

        return Response.json({ ok: true, sentTo: bodyResult.data.to });
      },
    },
  },
});
