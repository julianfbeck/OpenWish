import type { PublicFeedbackProject } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireProjectBySlug } from "#/server/auth";
import { publicError } from "#/server/http";
import { requireRequestContext } from "#/server/route-context";

// Public, unauthenticated lookup so the /feedback/<slug> page can render.
// Returns 404 when the project doesn't exist OR when its public form is
// disabled — same shape so a closed slug isn't distinguishable from an
// invalid one.

export const Route = createFileRoute("/api/public/projects/$slug")({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const requestContext = requireRequestContext(context);
        const projectResult = await requireProjectBySlug(
          { env: requestContext.env },
          params.slug,
        );

        if (!projectResult.ok) {
          return publicError(404, "Feedback page not found.");
        }

        const project = projectResult.project;
        if (project.public_form_enabled !== 1) {
          return publicError(404, "Feedback page not found.");
        }

        const body: PublicFeedbackProject = {
          name: project.name,
          slug: project.slug,
          enabled: true,
          turnstileSiteKey: requestContext.env.OPENWISH_TURNSTILE_SITE_KEY ?? null,
        };

        return Response.json(body);
      },
    },
  },
});
