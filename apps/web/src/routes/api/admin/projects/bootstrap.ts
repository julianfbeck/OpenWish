import { createFileRoute } from "@tanstack/react-router";

import { projectBootstrapRequestSchema } from "@openwish/shared";

import { requireDashboardSession } from "#/server/auth";
import { bootstrapProject } from "#/server/db";
import { parseJson, publicError } from "#/server/http";
import { requireRequestContext } from "#/server/route-context";

async function ensureProjectCreationAllowed(
  request: Request,
  env: ReturnType<typeof requireRequestContext>["env"],
) {
  const sessionResult = await requireDashboardSession({ env, request });
  if (sessionResult.ok) {
    return sessionResult;
  }

  const bootstrapToken = request.headers.get("x-openwish-bootstrap-token");
  if (!env.OPENWISH_BOOTSTRAP_TOKEN || bootstrapToken !== env.OPENWISH_BOOTSTRAP_TOKEN) {
    return { ok: false as const, response: publicError(401, "Dashboard login required.") };
  }

  return { ok: true as const };
}

export const Route = createFileRoute("/api/admin/projects/bootstrap")({
  server: {
    handlers: {
      POST: async ({ context, request }) => {
        const requestContext = requireRequestContext(context);
        const authResult = await ensureProjectCreationAllowed(request, requestContext.env);
        if (!authResult.ok) {
          return authResult.response;
        }

        const bodyResult = await parseJson(request, projectBootstrapRequestSchema);
        if (!bodyResult.success) {
          return bodyResult.response;
        }

        try {
          const response = await bootstrapProject(requestContext.env.DB, bodyResult.data);
          return Response.json(response, { status: 201 });
        } catch (error) {
          return publicError(
            409,
            error instanceof Error ? error.message : "Could not create project.",
          );
        }
      },
    },
  },
});
