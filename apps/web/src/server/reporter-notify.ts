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
): Promise<void> {
  const { env } = ctx;
  if (!input.to || input.unsubscribed) {
    return;
  }

  const token = await signUnsubscribeToken(env, project.id, input.userUuid);
  if (!token) {
    return;
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

  const guarded = work.then(() => undefined).catch(() => undefined);
  if (ctx.executionContext) {
    ctx.executionContext.waitUntil(guarded);
  } else {
    await guarded;
  }
}
