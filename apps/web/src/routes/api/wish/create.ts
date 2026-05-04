import { createWishRequestSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireProjectFromApiKey, requireUserUuid } from "#/server/auth";
import { createWish, upsertUser } from "#/server/db";
import { parseJson } from "#/server/http";
import { sendWishNotification } from "#/server/notifications";
import { enforceSdkRateLimit } from "#/server/rate-limit";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/wish/create")({
  server: {
    handlers: {
      POST: async ({ context, request }) => {
        const requestContext = requireRequestContext(context);
        const projectResult = await requireProjectFromApiKey({
          env: requestContext.env,
          request,
        });

        if (!projectResult.ok) {
          return projectResult.response;
        }

        const userResult = requireUserUuid(request, "sdk");
        if (!userResult.ok) {
          return userResult.response;
        }

        const limit = await enforceSdkRateLimit({
          env: requestContext.env,
          apiKey: projectResult.project.api_key,
          userUuid: userResult.uuid,
          kind: "write",
        });
        if (!limit.ok) {
          return limit.response;
        }

        const bodyResult = await parseJson(request, createWishRequestSchema, { errorMode: "sdk" });
        if (!bodyResult.success) {
          return bodyResult.response;
        }

        if (bodyResult.data.email) {
          await upsertUser(requestContext.env.DB, projectResult.project.id, userResult.uuid, {
            email: bodyResult.data.email,
          });
        }

        const response = await createWish(
          requestContext.env.DB,
          projectResult.project,
          userResult.uuid,
          bodyResult.data,
        );

        if (projectResult.project.notification_email) {
          const notify = sendWishNotification(requestContext.env, projectResult.project, {
            id: "",
            title: bodyResult.data.title,
            description: bodyResult.data.description,
            userUUID: userResult.uuid,
          }).catch(() => {
            // ignore — email failures must not break SDK responses
          });

          if (requestContext.executionContext) {
            requestContext.executionContext.waitUntil(notify);
          }
        }

        return Response.json(response);
      },
    },
  },
});
