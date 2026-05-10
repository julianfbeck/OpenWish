import { useEffect, useState } from "react";

import type { AdminProjectResponse } from "@openwish/shared";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Switch } from "#/components/ui/switch";
import {
  sendTestProjectEmail,
  updateProjectSettings,
} from "#/lib/api";
import { cn } from "#/lib/utils";

type SaveCallback = (response: AdminProjectResponse) => void;

type StatusKind = "info" | "error";
type Status = { kind: StatusKind; message: string };

export function NotificationSettings({
  slug,
  currentEmail,
  onSaved,
}: {
  slug: string;
  currentEmail: string | null;
  onSaved: SaveCallback;
}) {
  const [draft, setDraft] = useState(currentEmail ?? "");
  const [status, setStatus] = useState<Status | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    setDraft(currentEmail ?? "");
  }, [currentEmail]);

  const trimmed = draft.trim();
  const dirty = trimmed !== (currentEmail ?? "");

  return (
    <SettingsRow label="Notifications">
      <Input
        type="email"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="you@example.com"
        className="h-8 max-w-72 border-white/10 bg-neutral-900 text-sm text-neutral-100"
      />
      <Button
        size="sm"
        className="bg-white text-black hover:bg-neutral-200"
        disabled={!dirty || isSaving}
        onClick={async () => {
          setIsSaving(true);
          setStatus(null);
          try {
            const response = await updateProjectSettings(slug, {
              notificationEmail: trimmed === "" ? null : trimmed,
            });
            onSaved(response);
            setStatus({
              kind: "info",
              message:
                trimmed === "" ? "Notifications cleared." : "Notification email saved.",
            });
          } catch (nextError) {
            setStatus({
              kind: "error",
              message:
                nextError instanceof Error ? nextError.message : "Could not save email.",
            });
          } finally {
            setIsSaving(false);
          }
        }}
      >
        {isSaving ? "Saving…" : "Save"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="border-white/10 bg-transparent text-neutral-300 hover:bg-white/5 hover:text-white"
        disabled={trimmed === "" || isSending}
        onClick={async () => {
          if (trimmed === "") {
            return;
          }
          setIsSending(true);
          setStatus(null);
          try {
            await sendTestProjectEmail(slug, trimmed);
            setStatus({ kind: "info", message: `Test email sent to ${trimmed}.` });
          } catch (nextError) {
            setStatus({
              kind: "error",
              message:
                nextError instanceof Error ? nextError.message : "Could not send test email.",
            });
          } finally {
            setIsSending(false);
          }
        }}
      >
        {isSending ? "Sending…" : "Send test"}
      </Button>
      <StatusText status={status} />
    </SettingsRow>
  );
}

export function PublicFormSettings({
  slug,
  enabled,
  onSaved,
}: {
  slug: string;
  enabled: boolean;
  onSaved: SaveCallback;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [didCopy, setDidCopy] = useState(false);

  const publicUrl =
    typeof window === "undefined"
      ? `/feedback/${slug}`
      : `${window.location.origin}/feedback/${slug}`;

  return (
    <SettingsRow label="Public feedback form">
      <div className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300">
        <Switch
          checked={enabled}
          disabled={isSaving}
          className="data-unchecked:bg-neutral-600"
          onCheckedChange={async (checked) => {
            setIsSaving(true);
            setStatus(null);
            try {
              const response = await updateProjectSettings(slug, {
                publicFormEnabled: checked,
              });
              onSaved(response);
              setStatus({
                kind: "info",
                message: checked
                  ? "Public form enabled."
                  : "Public form disabled.",
              });
            } catch (nextError) {
              setStatus({
                kind: "error",
                message:
                  nextError instanceof Error
                    ? nextError.message
                    : "Could not update public form setting.",
              });
            } finally {
              setIsSaving(false);
            }
          }}
        />
        {enabled ? "On" : "Off"}
      </div>
      {enabled ? (
        <>
          <Input
            value={publicUrl}
            readOnly
            className="h-8 max-w-80 border-white/10 bg-neutral-900 text-sm text-neutral-300"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            size="sm"
            variant="outline"
            className="border-white/10 bg-transparent text-neutral-300 hover:bg-white/5 hover:text-white"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(publicUrl);
                setDidCopy(true);
                window.setTimeout(() => setDidCopy(false), 1500);
              } catch {
                setStatus({
                  kind: "error",
                  message: "Could not copy. Select the URL and copy manually.",
                });
              }
            }}
          >
            {didCopy ? "Copied" : "Copy URL"}
          </Button>
        </>
      ) : (
        <span className="text-xs text-neutral-500">
          Enable to expose <code className="text-neutral-400">/feedback/{slug}</code> for App Store support links.
        </span>
      )}
      <StatusText status={status} />
    </SettingsRow>
  );
}

export function AppLinkSettings({
  slug,
  currentUrl,
  appName,
  appIconUrl,
  onSaved,
}: {
  slug: string;
  currentUrl: string | null;
  appName: string | null;
  appIconUrl: string | null;
  onSaved: SaveCallback;
}) {
  const [draft, setDraft] = useState(currentUrl ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    setDraft(currentUrl ?? "");
  }, [currentUrl]);

  const trimmed = draft.trim();
  const dirty = trimmed !== (currentUrl ?? "");

  return (
    <SettingsRow label="App Store link">
      {appIconUrl ? (
        <img
          src={appIconUrl}
          alt={appName ? `${appName} icon` : "App icon"}
          className="size-8 rounded-md border border-white/10"
        />
      ) : null}
      <Input
        type="url"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="https://apps.apple.com/us/app/your-app/id123456789"
        className="h-8 max-w-96 border-white/10 bg-neutral-900 text-sm text-neutral-100"
      />
      <Button
        size="sm"
        className="bg-white text-black hover:bg-neutral-200"
        disabled={!dirty || isSaving}
        onClick={async () => {
          setIsSaving(true);
          setStatus(null);
          try {
            const response = await updateProjectSettings(slug, {
              appStoreUrl: trimmed === "" ? null : trimmed,
            });
            onSaved(response);
            const resolvedName = response.project.appName;
            setStatus({
              kind: "info",
              message:
                trimmed === ""
                  ? "App link cleared."
                  : resolvedName
                    ? `Linked: ${resolvedName}.`
                    : "Saved, but couldn't fetch app metadata. Check the URL.",
            });
          } catch (nextError) {
            setStatus({
              kind: "error",
              message:
                nextError instanceof Error ? nextError.message : "Could not save app link.",
            });
          } finally {
            setIsSaving(false);
          }
        }}
      >
        {isSaving ? "Saving…" : "Save"}
      </Button>
      {appName && !dirty ? (
        <span className="text-xs text-neutral-400">{appName}</span>
      ) : null}
      <StatusText status={status} />
    </SettingsRow>
  );
}

function SettingsRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-white/10 bg-neutral-950 px-4 py-3">
      <span className="text-[11px] uppercase tracking-wider text-neutral-500">
        {label}
      </span>
      {children}
    </div>
  );
}

function StatusText({ status }: { status: Status | null }) {
  if (!status) return null;
  return (
    <span
      className={cn(
        "text-xs",
        status.kind === "error" ? "text-red-300" : "text-neutral-400",
      )}
    >
      {status.message}
    </span>
  );
}
