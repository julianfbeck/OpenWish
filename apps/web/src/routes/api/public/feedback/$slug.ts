import {
  publicFeedbackSubmitRequestSchema,
  type PublicFeedbackSubmitResponse,
} from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireProjectBySlug } from "#/server/auth";
import { createBug, createWish, upsertUser } from "#/server/db";
import { parseJson, publicError } from "#/server/http";
import {
  sendBugNotification,
  sendWishNotification,
} from "#/server/notifications";
import { enforcePublicFormRateLimit } from "#/server/rate-limit";
import { requireRequestContext } from "#/server/route-context";
import { verifyTurnstileToken } from "#/server/turnstile";

function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export const Route = createFileRoute("/api/public/feedback/$slug")({
  server: {
    handlers: {
      POST: async ({ context, params, request }) => {
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
          // Same 404 shape as the missing-project case so a disabled slug isn't
          // distinguishable from an invalid one.
          return publicError(404, "Feedback page not found.");
        }

        const ip = clientIp(request);
        const limit = await enforcePublicFormRateLimit({
          env: requestContext.env,
          ip,
          apiKey: project.api_key,
        });
        if (!limit.ok) {
          return limit.response;
        }

        const bodyResult = await parseJson(request, publicFeedbackSubmitRequestSchema);
        if (!bodyResult.success) {
          return bodyResult.response;
        }

        const verification = await verifyTurnstileToken(
          requestContext.env,
          bodyResult.data.turnstileToken,
          ip === "unknown" ? null : ip,
        );
        if (!verification.ok) {
          return publicError(401, "Captcha verification failed. Please try again.");
        }

        // Each public submission gets a synthetic UUID. We never echo it back
        // to the submitter — it's only used so the existing per-row
        // userUuid plumbing has something to put in its column.
        const submitterUuid = crypto.randomUUID();
        const email = bodyResult.data.email;

        if (bodyResult.data.kind === "wish") {
          if (email) {
            await upsertUser(requestContext.env.DB, project.id, submitterUuid, { email });
          }

          const wish = await createWish(requestContext.env.DB, project, submitterUuid, {
            title: bodyResult.data.title,
            description: bodyResult.data.description,
            email: email ?? "",
            state: "pending",
          });

          if (project.notification_email) {
            const notify = sendWishNotification(requestContext.env, project, {
              id: wish.id,
              title: bodyResult.data.title,
              description: bodyResult.data.description,
              userUUID: submitterUuid,
            }).catch(() => {});
            if (requestContext.executionContext) {
              requestContext.executionContext.waitUntil(notify);
            }
          }

          const response: PublicFeedbackSubmitResponse = { kind: "wish", id: wish.id };
          return Response.json(response);
        }

        // kind === "bug"
        const bug = await createBug(requestContext.env.DB, project, submitterUuid, {
          title: bodyResult.data.title,
          description: bodyResult.data.description,
          email: email ?? undefined,
          screenshotKeys: [],
        });

        if (project.notification_email) {
          const notify = sendBugNotification(requestContext.env, project, {
            id: bug.id,
            title: bodyResult.data.title,
            description: bodyResult.data.description,
            userUUID: submitterUuid,
            reporterEmail: email,
            screenshotKeys: [],
          }).catch(() => {});
          if (requestContext.executionContext) {
            requestContext.executionContext.waitUntil(notify);
          }
        }

        const response: PublicFeedbackSubmitResponse = { kind: "bug", id: bug.id };
        return Response.json(response);
      },
    },
  },
});
