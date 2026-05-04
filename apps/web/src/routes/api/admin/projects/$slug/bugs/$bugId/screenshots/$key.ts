import { createFileRoute } from "@tanstack/react-router";

import { requireAdminProject } from "#/server/auth";
import { isScreenshotKeyForProject } from "#/server/bug-constants";
import { publicError } from "#/server/http";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute(
  "/api/admin/projects/$slug/bugs/$bugId/screenshots/$key",
)({
  server: {
    handlers: {
      GET: async ({ context, params, request }) => {
        const requestContext = requireRequestContext(context);
        const projectResult = await requireAdminProject(
          { env: requestContext.env, request },
          params.slug,
        );

        if (!projectResult.ok) {
          return projectResult.response;
        }

        const key = decodeURIComponent(params.key);
        if (!isScreenshotKeyForProject(key, projectResult.project.id)) {
          return publicError(403, "Forbidden.");
        }

        const object = await requestContext.env.BUGS_BUCKET.get(key);
        if (!object) {
          return publicError(404, "Screenshot not found.");
        }

        const headers = new Headers();
        const contentType = object.httpMetadata?.contentType ?? "application/octet-stream";
        headers.set("content-type", contentType);
        headers.set("cache-control", "private, max-age=300");
        return new Response(object.body, { headers });
      },
    },
  },
});
