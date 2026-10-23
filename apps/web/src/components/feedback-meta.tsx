import { useEffect, useState } from "react";

import { platformLabels, type GitHubLink, type Platform } from "@openwish/shared";
import { Check, CircleDot, GitPullRequest, Link2 } from "lucide-react";

import { cn } from "#/lib/utils";

export function PlatformBadge({
  platform,
  className,
}: {
  platform?: Platform | null;
  className?: string;
}) {
  if (!platform) {
    return null;
  }
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
        platform === "ios" ? "bg-white/10 text-neutral-200" : "bg-emerald-400/15 text-emerald-200",
        className,
      )}
    >
      {platformLabels[platform]}
    </span>
  );
}

function githubLinkLabel(link: GitHubLink) {
  return `${link.repository}#${link.number}`;
}

export function GitHubLinkCount({ links }: { links?: GitHubLink[] }) {
  if (!links || links.length === 0) {
    return null;
  }
  const Icon = links.some((link) => link.type === "pull") ? GitPullRequest : CircleDot;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 text-[11px] text-neutral-400"
      title={links.map(githubLinkLabel).join(", ")}
    >
      <Icon className="size-3" aria-hidden />
      {links.length} GitHub
    </span>
  );
}

export function GitHubLinkList({ links }: { links?: GitHubLink[] }) {
  const list = links ?? [];
  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wider text-neutral-500">GitHub ({list.length})</p>
      {list.length === 0 ? (
        <p className="text-xs text-neutral-500">
          No linked issues or pull requests. Agents can link them over MCP.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((link) => {
            const Icon = link.type === "pull" ? GitPullRequest : CircleDot;
            return (
              <li key={link.id}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 rounded border border-white/10 bg-neutral-900 p-2 text-xs transition hover:border-white/20"
                >
                  <Icon className="mt-0.5 size-3.5 shrink-0 text-neutral-400" aria-hidden />
                  <span className="min-w-0">
                    <span className="block break-words text-neutral-200">
                      {link.title ?? githubLinkLabel(link)}
                    </span>
                    <span className="block text-[11px] text-neutral-500">
                      {link.type === "pull" ? "Pull request" : "Issue"} · {githubLinkLabel(link)}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Copies the item's permanent dashboard URL (the same link the notification
// emails use).
export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 text-left text-sm text-neutral-300 hover:text-white"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
        } catch {
          window.prompt("Copy this link", url);
        }
      }}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />}
      {copied ? "Link copied" : "Copy link"}
    </button>
  );
}
