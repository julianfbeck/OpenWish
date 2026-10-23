import { platformLabels, type Platform } from "@openwish/shared";
import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

import { sendEmailViaCloudflare } from "./email";
import type { Bindings, ProjectRow } from "./types";

type NotificationKind = "wish" | "bug" | "test";

// Fallbacks used only when the corresponding env vars aren't set in
// wrangler.jsonc. Production deploys override these via OPENWISH_NOTIFICATION_FROM
// and OPENWISH_DASHBOARD_URL.
const DEFAULT_FROM = "noreply@example.com";
const DEFAULT_DASHBOARD = "https://wishkit.example.com";

function fromAddress(env: Bindings) {
  return env.OPENWISH_NOTIFICATION_FROM ?? DEFAULT_FROM;
}

function dashboardBase(env: Bindings) {
  return (env.OPENWISH_DASHBOARD_URL ?? DEFAULT_DASHBOARD).replace(/\/+$/, "");
}

// Direct dashboard links to one feature request or issue; the dashboard opens
// its detail view (after sign-in when needed).
export function featureDashboardUrl(env: Bindings, slug: string, wishId: string) {
  return `${dashboardBase(env)}/dashboard/${encodeURIComponent(slug)}/features/${encodeURIComponent(wishId)}`;
}

export function issueDashboardUrl(env: Bindings, slug: string, bugId: string) {
  return `${dashboardBase(env)}/dashboard/${encodeURIComponent(slug)}/bugs/${encodeURIComponent(bugId)}`;
}

function platformLine(platform: Platform | null | undefined): string[] {
  return platform ? [`Platform: ${platformLabels[platform]}`] : [];
}

// Emails carry the full feedback text, so a body can hold lines far beyond
// SMTP's 998-character limit and any language. Base64 in 76-character lines
// keeps both intact (mimetext sets the header but expects encoded data).
function base64Body(text: string) {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function buildMessage(input: { from: string; to: string; subject: string; text: string }) {
  const message = createMimeMessage();
  message.setSender({ name: "OpenWish", addr: input.from });
  message.setRecipient(input.to);
  message.setSubject(input.subject);
  message.addMessage({ contentType: "text/plain", encoding: "base64", data: base64Body(input.text) });
  return new EmailMessage(input.from, input.to, message.asRaw());
}

async function send(env: Bindings, to: string, subject: string, text: string) {
  const from = fromAddress(env);
  await env.NOTIFICATION_EMAIL.send(buildMessage({ from, to, subject, text }));
}

export async function sendTestEmail(env: Bindings, to: string, project: ProjectRow) {
  await send(
    env,
    to,
    `OpenWish — test notification for ${project.name}`,
    [
      `This is a test notification from the OpenWish dashboard.`,
      ``,
      `Project: ${project.name} (${project.slug})`,
      `If you're reading this, the email binding is wired up correctly.`,
      ``,
      `${dashboardBase(env)}/dashboard/${project.slug}`,
    ].join("\n"),
  );
}

export async function sendWishNotification(
  env: Bindings,
  project: ProjectRow,
  wish: { id: string; title: string; description: string; userUUID: string; platform?: Platform | null },
) {
  if (!project.notification_email) {
    return;
  }

  await send(
    env,
    project.notification_email,
    `[${project.name}] New feature request: ${wish.title}`,
    [
      `A new feature request was submitted to ${project.name}.`,
      ``,
      `Title: ${wish.title}`,
      ...platformLine(wish.platform),
      `Reporter: ${wish.userUUID}`,
      ``,
      `Description:`,
      wish.description,
      ``,
      `Open it in the dashboard:`,
      featureDashboardUrl(env, project.slug, wish.id),
    ].join("\n"),
  );
}

export async function sendBugNotification(
  env: Bindings,
  project: ProjectRow,
  bug: {
    id: string;
    title: string;
    description: string;
    userUUID: string;
    reporterEmail?: string | null;
    screenshotKeys: string[];
    platform?: Platform | null;
  },
) {
  if (!project.notification_email) {
    return;
  }

  const screenshotLine =
    bug.screenshotKeys.length > 0
      ? `Screenshots: ${bug.screenshotKeys.length} attached`
      : `Screenshots: none`;

  const reporterContact = bug.reporterEmail
    ? `Reporter: ${bug.userUUID} (${bug.reporterEmail})`
    : `Reporter: ${bug.userUUID}`;

  await send(
    env,
    project.notification_email,
    `[${project.name}] New bug report: ${bug.title}`,
    [
      `A new bug report was submitted to ${project.name}.`,
      ``,
      `Title: ${bug.title}`,
      ...platformLine(bug.platform),
      reporterContact,
      screenshotLine,
      ``,
      `Description:`,
      bug.description,
      ``,
      `Open it in the dashboard:`,
      issueDashboardUrl(env, project.slug, bug.id),
    ].join("\n"),
  );
}

export async function sendCommentNotification(
  env: Bindings,
  project: ProjectRow,
  comment: {
    kind: "wish" | "bug";
    // The feature request or issue the comment was posted on.
    id: string;
    title: string;
    description: string;
    userUUID: string;
  },
) {
  if (!project.notification_email) {
    return;
  }

  const isBug = comment.kind === "bug";
  const link = isBug
    ? issueDashboardUrl(env, project.slug, comment.id)
    : featureDashboardUrl(env, project.slug, comment.id);

  await send(
    env,
    project.notification_email,
    `[${project.name}] New comment on "${comment.title}"`,
    [
      `A new comment was posted on a ${isBug ? "bug report" : "feature request"} in ${project.name}.`,
      ``,
      `${isBug ? "Bug report" : "Feature request"}: ${comment.title}`,
      `Commenter: ${comment.userUUID}`,
      ``,
      `Comment:`,
      comment.description,
      ``,
      `Open it in the dashboard:`,
      link,
    ].join("\n"),
  );
}

// ── Reporter notifications (emails to the end user who submitted feedback) ──
//
// These go through the Cloudflare Email Service HTTP API (see ./email), because
// they must reach arbitrary recipient addresses — something the Email Routing
// `send_email` binding above cannot do. Every reporter email carries an
// unsubscribe link plus a List-Unsubscribe header.

export type ReporterFeedbackKind = "wish" | "bug";

export function buildUnsubscribeUrl(env: Bindings, token: string): string {
  return `${dashboardBase(env)}/api/public/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function buildFeedbackUrl(env: Bindings, slug: string): string {
  return `${dashboardBase(env)}/feedback/${slug}`;
}

function nounFor(kind: ReporterFeedbackKind) {
  return kind === "bug" ? "bug report" : "feature request";
}

function unsubscribeFooter(url: string): string[] {
  return [
    "",
    "—",
    "You're receiving this because you submitted feedback to this app.",
    `Unsubscribe: ${url}`,
  ];
}

function unsubscribeHeaders(url: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export async function sendReporterCommentEmail(
  env: Bindings,
  project: ProjectRow,
  input: {
    kind: ReporterFeedbackKind;
    title: string;
    to: string;
    comment: string;
    unsubscribeUrl: string;
    link?: string | null;
  },
): Promise<boolean> {
  const lines = [
    `${project.name} replied to your ${nounFor(input.kind)}:`,
    "",
    `"${input.title}"`,
    "",
    input.comment,
  ];
  if (input.link) {
    lines.push("", `View it: ${input.link}`);
  }
  lines.push(...unsubscribeFooter(input.unsubscribeUrl));

  return sendEmailViaCloudflare(env, {
    to: input.to,
    subject: `[${project.name}] New reply on "${input.title}"`,
    text: lines.join("\n"),
    headers: unsubscribeHeaders(input.unsubscribeUrl),
  });
}

export async function sendReporterResolvedEmail(
  env: Bindings,
  project: ProjectRow,
  input: {
    kind: ReporterFeedbackKind;
    title: string;
    to: string;
    unsubscribeUrl: string;
    link?: string | null;
  },
): Promise<boolean> {
  const resolution = input.kind === "bug" ? "fixed" : "implemented";
  const lines = [
    `Good news — your ${nounFor(input.kind)} has been marked ${resolution}:`,
    "",
    `"${input.title}"`,
  ];
  if (input.link) {
    lines.push("", `View it: ${input.link}`);
  }
  lines.push(...unsubscribeFooter(input.unsubscribeUrl));

  return sendEmailViaCloudflare(env, {
    to: input.to,
    subject: `[${project.name}] "${input.title}" was ${resolution}`,
    text: lines.join("\n"),
    headers: unsubscribeHeaders(input.unsubscribeUrl),
  });
}

export type { NotificationKind };
