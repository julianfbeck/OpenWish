import type { Bindings } from "./types";

// Single transport helper for Cloudflare Email Service (the transactional API,
// public beta launched April 2026). Unlike Email Routing's `send_email` binding
// — which can only deliver to verified destination addresses — this HTTP API
// delivers to arbitrary recipients, so it's what we use for end-user emails.
//
// Endpoint:
//   POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/email/sending/send
//   Authorization: Bearer {API_TOKEN}   (scope: email_sending:write)
//
// Returns true only on a clean send. A failure (misconfig, non-2xx, success:false,
// or a non-empty permanent_bounces array) returns false and logs — callers treat
// reporter emails as best-effort and never let a failure break the request.

const SEND_TIMEOUT_MS = 15_000;

type CloudflareAddress = string | { address: string; name: string };

export type CloudflareEmailInput = {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  /** Defaults to env.OPENWISH_NOTIFICATION_FROM. Accepts "Name <addr@host>" or "addr@host". */
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  headers?: Record<string, string>;
};

// "Display Name <addr@host>" → { name, address }; bare "addr@host" stays a string.
function parseAddress(value: string): CloudflareAddress {
  const match = value.match(/^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/);
  if (match && match[1] && match[2]) {
    return { address: match[2], name: match[1] };
  }
  return value.trim();
}

function asArray(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) ? value : [value];
}

export async function sendEmailViaCloudflare(
  env: Bindings,
  input: CloudflareEmailInput,
): Promise<boolean> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_EMAIL_API_TOKEN;
  const from = input.from ?? env.OPENWISH_NOTIFICATION_FROM;

  if (!accountId || !token || !from) {
    console.error(
      "[openwish] Cloudflare Email Service is not configured (need CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_EMAIL_API_TOKEN, OPENWISH_NOTIFICATION_FROM); skipping send.",
    );
    return false;
  }

  if (!input.text && !input.html) {
    console.error("[openwish] email send requires at least one of `text` or `html`.");
    return false;
  }

  const body: Record<string, unknown> = {
    to: input.to,
    from: parseAddress(from),
    subject: input.subject,
  };
  if (input.text) body.text = input.text;
  if (input.html) body.html = input.html;
  const cc = asArray(input.cc);
  if (cc) body.cc = cc;
  const bcc = asArray(input.bcc);
  if (bcc) body.bcc = bcc;
  if (input.replyTo) body.reply_to = input.replyTo;
  if (input.headers) body.headers = input.headers;

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      console.error(`[openwish] Cloudflare email send failed: HTTP ${response.status}.`);
      return false;
    }

    const payload = (await response.json().catch(() => null)) as
      | { success?: boolean; result?: { permanent_bounces?: unknown[] } }
      | null;

    if (!payload?.success) {
      console.error("[openwish] Cloudflare email send returned success:false.");
      return false;
    }

    const bounces = payload.result?.permanent_bounces;
    if (Array.isArray(bounces) && bounces.length > 0) {
      console.error("[openwish] Cloudflare email send reported permanent bounces.");
      return false;
    }

    return true;
  } catch (error) {
    console.error("[openwish] Cloudflare email send threw.", error);
    return false;
  }
}
