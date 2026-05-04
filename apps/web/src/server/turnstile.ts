import type { Bindings } from "./types";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Cloudflare's documented dummy secret that always passes — used so dev/test
// environments can run end-to-end without a real Turnstile widget.
const TEST_SECRET = "1x0000000000000000000000000000000AA";

export type TurnstileVerifyResult = {
  ok: boolean;
  errorCodes?: string[];
};

export async function verifyTurnstileToken(
  env: Bindings,
  token: string,
  remoteIp: string | null,
): Promise<TurnstileVerifyResult> {
  const secret = env.OPENWISH_TURNSTILE_SECRET_KEY ?? TEST_SECRET;

  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (remoteIp) {
    body.append("remoteip", remoteIp);
  }

  let payload: { success?: boolean; "error-codes"?: string[] };
  try {
    const response = await fetch(SITEVERIFY_URL, { method: "POST", body });
    payload = (await response.json()) as typeof payload;
  } catch (error) {
    console.error("turnstile siteverify failed", { error: String(error) });
    return { ok: false, errorCodes: ["network-error"] };
  }

  return {
    ok: payload.success === true,
    errorCodes: payload["error-codes"],
  };
}

export function isTurnstileConfigured(env: Bindings): boolean {
  return Boolean(env.OPENWISH_TURNSTILE_SITE_KEY && env.OPENWISH_TURNSTILE_SECRET_KEY);
}
