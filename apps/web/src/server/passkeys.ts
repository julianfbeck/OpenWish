import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/types";

import type { AuthChallengeRow, Bindings, PasskeyRow } from "./types";

const CHALLENGE_TTL_SECONDS = 5 * 60;

function rpId(env: Bindings): string {
  return env.OPENWISH_PASSKEY_RP_ID ?? "localhost";
}

function rpName(env: Bindings): string {
  return env.OPENWISH_PASSKEY_RP_NAME ?? "OpenWish";
}

function expectedOrigin(env: Bindings): string {
  return env.OPENWISH_DASHBOARD_URL ?? `https://${rpId(env)}`;
}

export type PasskeySummary = {
  credentialId: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

function toPasskeySummary(row: PasskeyRow): PasskeySummary {
  return {
    credentialId: row.credential_id,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

function base64UrlToUint8Array(value: string): Uint8Array {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

async function clearExpiredChallenges(db: D1Database) {
  await db
    .prepare(`DELETE FROM auth_challenges WHERE expires_at <= ?`)
    .bind(Date.now())
    .run();
}

async function insertChallenge(
  db: D1Database,
  args: { challenge: string; kind: "register" | "login"; userSubject: string },
) {
  await clearExpiredChallenges(db);
  await db
    .prepare(
      `INSERT INTO auth_challenges (challenge, kind, user_subject, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(challenge) DO UPDATE SET expires_at = excluded.expires_at`,
    )
    .bind(
      args.challenge,
      args.kind,
      args.userSubject,
      Date.now() + CHALLENGE_TTL_SECONDS * 1000,
    )
    .run();
}

async function consumeChallenge(
  db: D1Database,
  challenge: string,
  kind: "register" | "login",
): Promise<AuthChallengeRow | null> {
  const row = await db
    .prepare(
      `SELECT challenge, kind, user_subject, expires_at
       FROM auth_challenges
       WHERE challenge = ? AND kind = ? AND expires_at > ?
       LIMIT 1`,
    )
    .bind(challenge, kind, Date.now())
    .first<AuthChallengeRow>();
  if (row) {
    await db.prepare(`DELETE FROM auth_challenges WHERE challenge = ?`).bind(challenge).run();
  }
  return row ?? null;
}

export async function listPasskeys(
  db: D1Database,
  userSubject: string,
): Promise<PasskeySummary[]> {
  const result = await db
    .prepare(
      `SELECT credential_id, user_subject, public_key, counter, transports,
              device_type, backed_up, label, created_at, last_used_at
       FROM auth_passkeys
       WHERE user_subject = ?
       ORDER BY datetime(created_at) DESC`,
    )
    .bind(userSubject)
    .all<PasskeyRow>();
  return (result.results ?? []).map(toPasskeySummary);
}

export async function hasAnyPasskey(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare(`SELECT credential_id FROM auth_passkeys LIMIT 1`)
    .first<{ credential_id: string }>();
  return Boolean(row);
}

export async function deletePasskey(
  db: D1Database,
  userSubject: string,
  credentialId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `DELETE FROM auth_passkeys
       WHERE user_subject = ? AND credential_id = ?`,
    )
    .bind(userSubject, credentialId)
    .run();
  return Boolean(result.meta?.changes ?? 0);
}

async function loadCredential(
  db: D1Database,
  credentialId: string,
): Promise<PasskeyRow | null> {
  const row = await db
    .prepare(
      `SELECT credential_id, user_subject, public_key, counter, transports,
              device_type, backed_up, label, created_at, last_used_at
       FROM auth_passkeys
       WHERE credential_id = ?
       LIMIT 1`,
    )
    .bind(credentialId)
    .first<PasskeyRow>();
  return row ?? null;
}

export async function buildRegistrationOptions(
  env: Bindings,
  userSubject: string,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const existing = await env.DB.prepare(
    `SELECT credential_id, transports
     FROM auth_passkeys
     WHERE user_subject = ?`,
  )
    .bind(userSubject)
    .all<{ credential_id: string; transports: string | null }>();

  const excludeCredentials = (existing.results ?? []).map((entry) => ({
    id: entry.credential_id,
    transports: entry.transports
      ? (JSON.parse(entry.transports) as AuthenticatorTransport[])
      : undefined,
  }));

  const userIdBytes = new TextEncoder().encode(userSubject);

  const options = await generateRegistrationOptions({
    rpName: rpName(env),
    rpID: rpId(env),
    userID: userIdBytes,
    userName: userSubject,
    userDisplayName: userSubject,
    attestationType: "none",
    excludeCredentials,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  await insertChallenge(env.DB, {
    challenge: options.challenge,
    kind: "register",
    userSubject,
  });

  return options;
}

export async function verifyAndStoreRegistration(
  env: Bindings,
  userSubject: string,
  attestation: RegistrationResponseJSON,
  label: string | null,
): Promise<{ ok: true; passkey: PasskeySummary } | { ok: false; reason: string }> {
  const challengeRow = await consumeChallenge(env.DB, attestation.response.clientDataJSON
    ? extractChallenge(attestation.response.clientDataJSON)
    : "", "register");

  if (!challengeRow || challengeRow.user_subject !== userSubject) {
    return { ok: false, reason: "Challenge expired or unknown." };
  }

  const verification = await verifyRegistrationResponse({
    response: attestation,
    expectedChallenge: challengeRow.challenge,
    expectedOrigin: expectedOrigin(env),
    expectedRPID: rpId(env),
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, reason: "Passkey verification failed." };
  }

  const info = verification.registrationInfo;
  const credentialId = info.credential.id;
  const publicKey = uint8ArrayToBase64Url(info.credential.publicKey);
  const counter = info.credential.counter;
  const transports = info.credential.transports
    ? JSON.stringify(info.credential.transports)
    : null;
  const createdAt = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO auth_passkeys (
       credential_id, user_subject, public_key, counter, transports,
       device_type, backed_up, label, created_at, last_used_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  )
    .bind(
      credentialId,
      userSubject,
      publicKey,
      counter,
      transports,
      info.credentialDeviceType ?? null,
      info.credentialBackedUp ? 1 : 0,
      label,
      createdAt,
    )
    .run();

  return {
    ok: true,
    passkey: {
      credentialId,
      label,
      createdAt,
      lastUsedAt: null,
    },
  };
}

export async function buildAuthenticationOptions(
  env: Bindings,
  userSubject: string,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const credentials = await env.DB.prepare(
    `SELECT credential_id, transports
     FROM auth_passkeys
     WHERE user_subject = ?`,
  )
    .bind(userSubject)
    .all<{ credential_id: string; transports: string | null }>();

  const allowCredentials = (credentials.results ?? []).map((entry) => ({
    id: entry.credential_id,
    transports: entry.transports
      ? (JSON.parse(entry.transports) as AuthenticatorTransport[])
      : undefined,
  }));

  const options = await generateAuthenticationOptions({
    rpID: rpId(env),
    userVerification: "preferred",
    allowCredentials,
  });

  await insertChallenge(env.DB, {
    challenge: options.challenge,
    kind: "login",
    userSubject,
  });

  return options;
}

export async function verifyAuthentication(
  env: Bindings,
  userSubject: string,
  assertion: AuthenticationResponseJSON,
): Promise<{ ok: true; credentialId: string } | { ok: false; reason: string }> {
  const challenge = assertion.response.clientDataJSON
    ? extractChallenge(assertion.response.clientDataJSON)
    : "";
  const challengeRow = await consumeChallenge(env.DB, challenge, "login");
  if (!challengeRow || challengeRow.user_subject !== userSubject) {
    return { ok: false, reason: "Challenge expired or unknown." };
  }

  const credential = await loadCredential(env.DB, assertion.id);
  if (!credential || credential.user_subject !== userSubject) {
    return { ok: false, reason: "Unknown credential." };
  }

  const verification = await verifyAuthenticationResponse({
    response: assertion,
    expectedChallenge: challengeRow.challenge,
    expectedOrigin: expectedOrigin(env),
    expectedRPID: rpId(env),
    requireUserVerification: false,
    credential: {
      id: credential.credential_id,
      publicKey: base64UrlToUint8Array(credential.public_key),
      counter: credential.counter,
      transports: credential.transports
        ? (JSON.parse(credential.transports) as AuthenticatorTransport[])
        : undefined,
    },
  });

  if (!verification.verified) {
    return { ok: false, reason: "Authentication failed." };
  }

  await env.DB.prepare(
    `UPDATE auth_passkeys
     SET counter = ?, last_used_at = ?
     WHERE credential_id = ?`,
  )
    .bind(verification.authenticationInfo.newCounter, new Date().toISOString(), credential.credential_id)
    .run();

  return { ok: true, credentialId: credential.credential_id };
}

function extractChallenge(clientDataJSONBase64Url: string): string {
  try {
    const decoded = new TextDecoder().decode(base64UrlToUint8Array(clientDataJSONBase64Url));
    const parsed = JSON.parse(decoded) as { challenge?: string };
    return parsed.challenge ?? "";
  } catch {
    return "";
  }
}
