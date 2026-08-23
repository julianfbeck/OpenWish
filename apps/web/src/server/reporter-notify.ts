import {
  buildFeedbackUrl,
  buildUnsubscribeUrl,
  sendReporterCommentEmail,
  sendReporterResolvedEmail,
  type ReporterFeedbackKind,
} from "./notifications";
import type { ProjectRow, ServerRequestContext } from "./types";
import { signUnsubscribeToken } from "./unsubscribe";

// Best-effort reporter notification: resolves the unsubscribe link, picks the
// right email template, and dispatches the send without ever blocking or
// breaking the admin's action. Skips silently when there's no recipient, the
// reporter has unsubscribed, or signing isn't configured. When the runtime
// gives us an executionContext we defer with waitUntil; otherwise (e.g. tests)
// we await so the send completes within the request.
export async function notifyReporter(
  ctx: ServerRequestContext,
  project: ProjectRow,
  input: {
    event: "comment" | "resolved";
    kind: ReporterFeedbackKind;
    userUuid: string;
    title: string;
    to: string | null;
    unsubscribed: boolean;
    comment?: string;
  },
): Promise<"accepted" | "skipped_no_email" | "skipped_unsubscribed" | "failed"> {
  const { env } = ctx;
  if (!input.to) {
    return "skipped_no_email";
  }
  if (input.unsubscribed) {
    return "skipped_unsubscribed";
  }

  const token = await signUnsubscribeToken(env, project.id, input.userUuid);
  if (!token) {
    console.error("[openwish] Reporter email skipped: unsubscribe signing is not configured.");
    return "failed";
  }

  const unsubscribeUrl = buildUnsubscribeUrl(env, token);
  const link = input.kind === "wish" ? buildFeedbackUrl(env, project.slug) : null;

  const work =
    input.event === "comment"
      ? sendReporterCommentEmail(env, project, {
          kind: input.kind,
          title: input.title,
          to: input.to,
          comment: input.comment ?? "",
          unsubscribeUrl,
          link,
        })
      : sendReporterResolvedEmail(env, project, {
          kind: input.kind,
          title: input.title,
          to: input.to,
          unsubscribeUrl,
          link,
        });

  try {
    // Cloudflare's synchronous API confirms acceptance/queueing, not final
    // SMTP delivery. Final delivery can still fail later in its Activity Log.
    return (await work) ? "accepted" : "failed";
  } catch (error) {
    console.error("[openwish] Reporter email threw.", error);
    return "failed";
  }
}
