import { useEffect, useState } from "react";
import { Copy, Eye, EyeOff, KeyRound } from "lucide-react";

import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { fetchMcpAccess, type McpAccess } from "#/lib/api";

export function McpAccessPanel() {
  const [access, setAccess] = useState<McpAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<"endpoint" | "token" | null>(null);

  useEffect(() => {
    let active = true;
    void fetchMcpAccess()
      .then((value) => active && setAccess(value))
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : "Could not load MCP access.");
      });
    return () => {
      active = false;
    };
  }, []);

  async function copy(kind: "endpoint" | "token", value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1_500);
  }

  return (
    <Card className="border-white/10 bg-neutral-950">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 size-4 text-neutral-400" />
          <div>
            <h3 className="text-sm font-medium text-white">Agent access (MCP)</h3>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">
              Choose projects with OAuth, or use a global API key for full access.
            </p>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-neutral-400">
          For ChatGPT, connect the MCP URL using OAuth, sign in, and choose projects and permissions.{" "}
          <a href="/oauth/grants" className="text-neutral-200 underline underline-offset-2">Manage OAuth access</a>.
        </p>

        {error ? <p className="text-xs text-red-300">Global API key: {error}</p> : null}
        {!access && !error ? <p className="text-xs text-neutral-500">Loading…</p> : null}

        {access ? (
          <div className="space-y-3">
            <SecretRow
              label="Remote MCP URL"
              displayValue={access.endpoint}
              copied={copied === "endpoint"}
              onCopy={() => copy("endpoint", access.endpoint)}
            />
            <SecretRow
              label="Global API key"
              displayValue={revealed ? access.token : `••••••••••••${access.token.slice(-6)}`}
              copied={copied === "token"}
              onCopy={() => copy("token", access.token)}
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-8 border-white/10 bg-transparent text-neutral-400 hover:bg-white/5 hover:text-white"
                  aria-label={revealed ? "Hide bearer" : "Reveal bearer"}
                  onClick={() => setRevealed((value) => !value)}
                >
                  {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </Button>
              }
            />
            <p className="text-[11px] leading-relaxed text-neutral-600">
              Send <code className="text-neutral-400">Authorization: Bearer &lt;token&gt;</code> to the MCP URL. The same credential can act across all projects.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SecretRow({
  label,
  displayValue,
  copied,
  onCopy,
  action,
}: {
  label: string;
  displayValue: string;
  copied: boolean;
  onCopy: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] uppercase tracking-wider text-neutral-500">{label}</p>
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-white/10 bg-black px-2.5 py-2 text-[11px] text-neutral-300">
          {displayValue}
        </code>
        {action}
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 border-white/10 bg-transparent text-neutral-400 hover:bg-white/5 hover:text-white"
          aria-label={`Copy ${label}`}
          onClick={onCopy}
        >
          {copied ? <span className="text-[10px]">OK</span> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}
