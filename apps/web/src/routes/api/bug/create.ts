import { createBugRequestSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireProjectFromApiKey, requireUserUuid } from "#/server/auth";
import { isScreenshotKeyForProject } from "#/server/bug-constants";
import { createBug } from "#/server/db";
import { parseJson, sdkError } from "#/server/http";
import { sendBugNotification } from "#/server/notifications";
import { enforceSdkRateLimit } from "#/server/rate-limit";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/bug/create")({
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

        const bodyResult = await parseJson(request, createBugRequestSchema, {
          errorMode: "sdk",
        });
        if (!bodyResult.success) {
          return bodyResult.response;
        }

        const projectId = projectResult.project.id;
        const keys = bodyResult.data.screenshotKeys ?? [];

        for (const key of keys) {
          if (!isScreenshotKeyForProject(key, projectId)) {
            return sdkError("couldNotCreateRequest", 400);
          }

          const head = await requestContext.env.BUGS_BUCKET.head(key);
          if (!head) {
            return sdkError("couldNotCreateRequest", 400);
          }
        }

        const response = await createBug(
          requestContext.env.DB,
          projectResult.project,
          userResult.uuid,
          bodyResult.data,
        );

        if (projectResult.project.notification_email) {
          const notify = sendBugNotification(requestContext.env, projectResult.project, {
            id: response.id,
            title: bodyResult.data.title,
            description: bodyResult.data.description,
            userUUID: userResult.uuid,
            reporterEmail: bodyResult.data.email ?? null,
            screenshotKeys: keys,
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
