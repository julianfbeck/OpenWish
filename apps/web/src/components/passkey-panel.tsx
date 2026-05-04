import { useEffect, useState } from "react";

import {
  browserSupportsWebAuthn,
  startRegistration,
} from "@simplewebauthn/browser";
import type { PasskeySummary } from "@openwish/shared";
import { Fingerprint, KeyRound, Trash2 } from "lucide-react";

import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import {
  ApiRequestError,
  deletePasskey,
  fetchPasskeyList,
  fetchPasskeyRegisterOptions,
  verifyPasskeyRegistration,
} from "#/lib/api";
import { formatDate } from "#/lib/format";

export function PasskeyPanel() {
  const [list, setList] = useState<PasskeySummary[] | null>(null);
  const [supported, setSupported] = useState(false);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
    void reload();
  }, []);

  async function reload() {
    try {
      const response = await fetchPasskeyList();
      setList(response.list);
    } catch (nextError) {
      setError(
        nextError instanceof ApiRequestError
          ? nextError.message
          : "Could not load passkeys.",
      );
    }
  }

  async function handleRegister() {
    setIsRegistering(true);
    setError(null);
    setInfo(null);
    try {
      const options = await fetchPasskeyRegisterOptions();
      const attestation = await startRegistration({ optionsJSON: options });
      await verifyPasskeyRegistration(attestation, label.trim() === "" ? null : label.trim());
      setLabel("");
      setInfo("Passkey added.");
      await reload();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message === "The operation either timed out or was not allowed."
            ? "Registration was cancelled."
            : nextError.message
          : "Could not register passkey.",
      );
    } finally {
      setIsRegistering(false);
    }
  }

  async function handleRevoke(credentialId: string) {
    setRevokingId(credentialId);
    setError(null);
    setInfo(null);
    try {
      await deletePasskey(credentialId);
      setInfo("Passkey removed.");
      await reload();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Could not remove passkey.",
      );
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Card className="border-white/10 bg-neutral-950">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-neutral-400" />
          <h3 className="text-sm font-medium text-white">Passkeys</h3>
        </div>
        <p className="text-xs text-neutral-500">
          Sign in to the dashboard from this device with Touch ID, Face ID, Windows Hello,
          or any roaming security key. Passwords still work as a fallback.
        </p>

        {!supported ? (
          <div className="rounded-md border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
            This browser doesn't support WebAuthn.
          </div>
        ) : null}

        {list && list.length > 0 ? (
          <div className="space-y-2">
            {list.map((passkey) => (
              <div
                key={passkey.credentialId}
                className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">
                    {passkey.label ?? "Unnamed passkey"}
                  </p>
                  <p className="truncate text-[11px] text-neutral-500">
                    Added {formatDate(passkey.createdAt)}
                    {passkey.lastUsedAt
                      ? ` · last used ${formatDate(passkey.lastUsedAt)}`
                      : null}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-white/10 bg-transparent text-neutral-400 hover:bg-white/5 hover:text-white"
                  disabled={revokingId === passkey.credentialId}
                  onClick={() => handleRevoke(passkey.credentialId)}
                >
                  <Trash2 className="size-3.5" />
                  {revokingId === passkey.credentialId ? "Removing…" : "Remove"}
                </Button>
              </div>
            ))}
          </div>
        ) : list && list.length === 0 ? (
          <p className="text-xs text-neutral-500">
            No passkeys registered yet.
          </p>
        ) : null}

        <div className="space-y-2 border-t border-white/10 pt-4">
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Optional label (e.g. MacBook Touch ID)"
            className="h-9 border-white/10 bg-neutral-900 text-sm text-neutral-100"
            maxLength={80}
            disabled={!supported || isRegistering}
          />
          <Button
            size="sm"
            className="bg-white text-black hover:bg-neutral-200"
            disabled={!supported || isRegistering}
            onClick={handleRegister}
          >
            <Fingerprint className="size-4" />
            {isRegistering ? "Waiting for device…" : "Add passkey on this device"}
          </Button>
          {error ? <p className="text-xs text-red-300">{error}</p> : null}
          {info ? <p className="text-xs text-emerald-300">{info}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
