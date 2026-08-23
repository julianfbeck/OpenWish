import { createV2IssueRequestSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireProjectFromApiKey, requireUserUuid } from "#/server/auth";
import { isScreenshotKeyForProject } from "#/server/bug-constants";
import { createV2Issue, loadUserIssuesV2 } from "#/server/db";
import { parseJson, sdkError } from "#/server/http";
import { sendBugNotification } from "#/server/notifications";
import { enforceSdkRateLimit } from "#/server/rate-limit";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/v2/issues")({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const requestContext = requireRequestContext(context);
        const projectResult = await requireProjectFromApiKey({ env: requestContext.env, request });
        if (!projectResult.ok) return projectResult.response;
        const userResult = requireUserUuid(request, "sdk");
        if (!userResult.ok) return userResult.response;
        const limit = await enforceSdkRateLimit({
          env: requestContext.env,
          apiKey: projectResult.project.api_key,
          userUuid: userResult.uuid,
          kind: "read",
        });
        if (!limit.ok) return limit.response;
        return Response.json({
          list: await loadUserIssuesV2(requestContext.env.DB, projectResult.project, userResult.uuid),
        });
      },
      POST: async ({ context, request }) => {
        const requestContext = requireRequestContext(context);
        const projectResult = await requireProjectFromApiKey({ env: requestContext.env, request });
        if (!projectResult.ok) return projectResult.response;
        const userResult = requireUserUuid(request, "sdk");
        if (!userResult.ok) return userResult.response;
        const limit = await enforceSdkRateLimit({
          env: requestContext.env,
          apiKey: projectResult.project.api_key,
          userUuid: userResult.uuid,
          kind: "write",
        });
        if (!limit.ok) return limit.response;
        const body = await parseJson(request, createV2IssueRequestSchema, { errorMode: "sdk" });
        if (!body.success) return body.response;

        for (const key of body.data.screenshotKeys) {
          if (!isScreenshotKeyForProject(key, projectResult.project.id)) {
            return sdkError("couldNotCreateRequest", 400);
          }
          if (!(await requestContext.env.BUGS_BUCKET.head(key))) {
            return sdkError("couldNotCreateRequest", 400);
          }
        }
        const created = await createV2Issue(
          requestContext.env.DB,
          projectResult.project,
          userResult.uuid,
          body.data,
        );
        if (projectResult.project.notification_email) {
          const notify = sendBugNotification(requestContext.env, projectResult.project, {
            id: created.id,
            title: body.data.title,
            description: body.data.description,
            userUUID: userResult.uuid,
            reporterEmail: body.data.email ?? null,
            screenshotKeys: body.data.screenshotKeys,
          }).catch(() => undefined);
          requestContext.executionContext?.waitUntil(notify);
        }
        return Response.json(created, { status: 201 });
      },
    },
  },
});
