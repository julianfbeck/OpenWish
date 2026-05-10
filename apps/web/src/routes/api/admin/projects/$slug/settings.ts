import { adminProjectSettingsSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { resolveAppStoreMetadata } from "#/server/app-store";
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

        const patch: Parameters<typeof updateProjectSettings>[2] = {
          watermarkEnabled: bodyResult.data.watermarkEnabled,
          notificationEmail:
            bodyResult.data.notificationEmail === undefined
              ? undefined
              : bodyResult.data.notificationEmail === ""
                ? null
                : bodyResult.data.notificationEmail,
          publicFormEnabled: bodyResult.data.publicFormEnabled,
        };

        // App Store URL: empty string / null clears all four columns; a non-empty
        // URL gets resolved synchronously via the iTunes Search API. If resolution
        // fails (bad URL, network issue) we still persist the raw URL but null
        // out the cached metadata, so the admin sees the failure on next reload.
        if (bodyResult.data.appStoreUrl !== undefined) {
          const trimmed =
            typeof bodyResult.data.appStoreUrl === "string"
              ? bodyResult.data.appStoreUrl.trim()
              : "";
          if (trimmed === "" || bodyResult.data.appStoreUrl === null) {
            patch.appStoreUrl = null;
            patch.appId = null;
            patch.appName = null;
            patch.appIconUrl = null;
          } else {
            const resolved = await resolveAppStoreMetadata(trimmed);
            patch.appStoreUrl = trimmed;
            patch.appId = resolved?.appId ?? null;
            patch.appName = resolved?.appName ?? null;
            patch.appIconUrl = resolved?.appIconUrl ?? null;
          }
        }

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
