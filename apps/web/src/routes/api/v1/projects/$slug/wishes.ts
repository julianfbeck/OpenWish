import { createWishRequestSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireGlobalApiKey, requireProjectBySlug } from "#/server/auth";
import { createWish, loadWishesForProject, upsertUser } from "#/server/db";
import { parseJson } from "#/server/http";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/v1/projects/$slug/wishes")({
  server: {
    handlers: {
      GET: async ({ context, params, request }) => {
        const requestContext = requireRequestContext(context);
        const auth = requireGlobalApiKey({ env: requestContext.env, request });
        if (!auth.ok) {
          return auth.response;
        }

        const projectResult = await requireProjectBySlug(
          { env: requestContext.env },
          params.slug,
        );
        if (!projectResult.ok) {
          return projectResult.response;
        }

        const list = await loadWishesForProject(requestContext.env.DB, projectResult.project);
        return Response.json(list);
      },
      POST: async ({ context, params, request }) => {
        const requestContext = requireRequestContext(context);
        const auth = requireGlobalApiKey({ env: requestContext.env, request });
        if (!auth.ok) {
          return auth.response;
        }

        const projectResult = await requireProjectBySlug(
          { env: requestContext.env },
          params.slug,
        );
        if (!projectResult.ok) {
          return projectResult.response;
        }

        const body = await parseJson(request, createWishRequestSchema);
        if (!body.success) {
          return body.response;
        }

        const userUuid = crypto.randomUUID();
        if (body.data.email) {
          await upsertUser(requestContext.env.DB, projectResult.project.id, userUuid, {
            email: body.data.email,
          });
        }

        const created = await createWish(
          requestContext.env.DB,
          projectResult.project,
          userUuid,
          body.data,
        );
        return Response.json(created, { status: 201 });
      },
    },
  },
});
