import { useEffect, useState } from "react";

import { startAuthentication } from "@simplewebauthn/browser";
import { createFileRoute } from "@tanstack/react-router";
import { Fingerprint } from "lucide-react";

import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import {
  fetchPasskeyAvailability,
  fetchPasskeyLoginOptions,
  loginDashboard,
  verifyPasskeyLogin,
} from "#/lib/api";
import { assignLocation } from "#/lib/navigation";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

export function LoginPage() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasPasskey, setHasPasskey] = useState(false);
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPasskeyAvailability()
      .then((response) => {
        if (!cancelled) {
          setHasPasskey(response.hasPasskey);
        }
      })
      .catch(() => {
        // Ignore — fall back to password auth.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function postLoginRedirect() {
    const search = new URLSearchParams(window.location.search);
    const next = search.get("next");
    assignLocation(next || "/dashboard/projects");
  }

  async function handlePasskeyLogin() {
    setIsPasskeyLoading(true);
    setError(null);
    try {
      const options = await fetchPasskeyLoginOptions();
      const assertion = await startAuthentication({ optionsJSON: options });
      await verifyPasskeyLogin(assertion);
      postLoginRedirect();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message === "The operation either timed out or was not allowed."
            ? "Passkey sign-in was cancelled."
            : nextError.message
          : "Could not sign in with passkey.",
      );
    } finally {
      setIsPasskeyLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-black px-5 py-10 text-neutral-100">
      <Card className="w-full max-w-sm border-white/10 bg-neutral-950">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="grid size-7 place-items-center rounded-md bg-white text-xs font-semibold text-black">
              OW
            </div>
            <span className="text-sm font-medium tracking-tight text-white">OpenWish</span>
          </div>
          <CardTitle className="pt-4 text-xl font-medium tracking-tight text-white">
            Sign in
          </CardTitle>
          <p className="text-sm text-neutral-500">
            {hasPasskey
              ? "Use the passkey registered for this dashboard."
              : "Single-user dashboard auth."}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasPasskey ? (
            <>
              <Button
                type="button"
                className="h-9 w-full bg-white text-black hover:bg-neutral-200"
                disabled={isPasskeyLoading}
                onClick={handlePasskeyLogin}
              >
                <Fingerprint className="size-4" />
                {isPasskeyLoading ? "Waiting for passkey…" : "Sign in with passkey"}
              </Button>
              {error ? (
                <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              ) : null}
              <p className="text-[11px] leading-relaxed text-neutral-500">
                Lost every device? Recover by deleting the rows in{" "}
                <code className="rounded bg-white/5 px-1 py-0.5 text-[10px] text-neutral-300">
                  auth_passkeys
                </code>{" "}
                via{" "}
                <code className="rounded bg-white/5 px-1 py-0.5 text-[10px] text-neutral-300">
                  wrangler d1 execute
                </code>{" "}
                — the password fallback re-activates automatically.
              </p>
            </>
          ) : (
            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                setIsLoading(true);
                setError(null);

                try {
                  await loginDashboard(username, password);
                  postLoginRedirect();
                } catch (nextError) {
                  setError(
                    nextError instanceof Error ? nextError.message : "Could not sign in.",
                  );
                } finally {
                  setIsLoading(false);
                }
              }}
            >
              <label className="grid gap-1.5">
                <span className="text-xs text-neutral-400">Username</span>
                <Input
                  className="h-9 border-white/10 bg-neutral-900 text-neutral-100"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs text-neutral-400">Password</span>
                <Input
                  className="h-9 border-white/10 bg-neutral-900 text-neutral-100"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              {error ? (
                <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              ) : null}
              <Button
                className="h-9 w-full bg-white text-black hover:bg-neutral-200"
                disabled={isLoading}
              >
                {isLoading ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
