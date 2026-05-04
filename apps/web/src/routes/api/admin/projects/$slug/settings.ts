import { adminProjectSettingsSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireAdminProject } from "#/server/auth";
import { loadAdminProject, loadProjectById, updateProjectSettings } from "#/server/db";
import { parseJson, publicError } from "#/server/http";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/admin/projects/$slug/settings")({
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

        const bodyResult = await parseJson(request, adminProjectSettingsSchema);
        if (!bodyResult.success) {
          return bodyResult.response;
        }

        const patch = {
          watermarkEnabled: bodyResult.data.watermarkEnabled,
          notificationEmail:
            bodyResult.data.notificationEmail === undefined
              ? undefined
              : bodyResult.data.notificationEmail === ""
                ? null
                : bodyResult.data.notificationEmail,
        };

        await updateProjectSettings(requestContext.env.DB, projectResult.project.id, patch);

        const refreshed =
          (await loadProjectById(requestContext.env.DB, projectResult.project.id)) ??
          projectResult.project;

        if (!refreshed) {
          return publicError(404, "Project not found.");
        }

        const response = await loadAdminProject(requestContext.env.DB, refreshed);
        return Response.json(response);
      },
    },
  },
});
