import { useEffect, useMemo, useState } from "react";

import type { BugResponse, BugState } from "@openwish/shared";
import { bugStateLabels, bugStateValues } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { BugDetailDialog } from "#/components/bug-detail-dialog";
import { Card, CardContent } from "#/components/ui/card";
import { DashboardShell } from "#/components/dashboard-shell";
import {
  ApiRequestError,
  bugScreenshotUrl,
  createAdminBugComment,
  deleteAdminBug,
  fetchAdminBugs,
  updateAdminBug,
} from "#/lib/api";
import { formatDate } from "#/lib/format";
import { assignLocation } from "#/lib/navigation";
import { useDashboardSession } from "#/lib/use-dashboard-session";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/dashboard/$slug/bugs")({
  component: DashboardBugsPage,
});

type FilterState = "all" | BugState;

const filterOrder: FilterState[] = ["all", ...bugStateValues];

const filterLabels: Record<FilterState, string> = {
  all: "All",
  ...bugStateLabels,
};

export function DashboardBugsPage() {
  const { slug } = Route.useParams();
  const { error: sessionError, isLoading, projects, sessionUsername } = useDashboardSession();
  const [bugs, setBugs] = useState<BugResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterState>("all");
  const [selectedBugId, setSelectedBugId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const selectedBug = bugs?.find((bug) => bug.id === selectedBugId) ?? null;
  const projectName = projects.find((project) => project.slug === slug)?.name;

  const counts = useMemo(() => {
    const result: Record<FilterState, number> = {
      all: bugs?.length ?? 0,
      open: 0,
      confirmed: 0,
      inProgress: 0,
      fixed: 0,
      wontFix: 0,
      duplicate: 0,
    };
    for (const bug of bugs ?? []) {
      result[bug.state] += 1;
    }
    return result;
  }, [bugs]);

  const filtered = useMemo(() => {
    if (!bugs) {
      return [];
    }
    if (filter === "all") {
      return bugs;
    }
    return bugs.filter((bug) => bug.state === filter);
  }, [bugs, filter]);

  useEffect(() => {
    if (!slug) {
      return;
    }

    let cancelled = false;

    async function loadBugs() {
      try {
        setError(null);
        const response = await fetchAdminBugs(slug);
        if (!cancelled) {
          setBugs(response.list);
        }
      } catch (nextError) {
        if (cancelled) {
          return;
        }

        if (nextError instanceof ApiRequestError && nextError.status === 401) {
          assignLocation(`/login?next=${encodeURIComponent(window.location.pathname)}`);
          return;
        }

        setError(nextError instanceof Error ? nextError.message : "Could not load bugs.");
      }
    }

    void loadBugs();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <DashboardShell
      active="bugs"
      projects={projects}
      sessionUsername={sessionUsername}
      projectName={projectName}
      projectSlug={slug}
      actions={undefined}
    >
      <section className="space-y-4">
        {sessionError || error ? (
          <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error ?? sessionError}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-1.5">
          {filterOrder.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
                filter === value
                  ? "border-white/30 bg-white text-black"
                  : "border-white/10 bg-transparent text-neutral-400 hover:border-white/20 hover:text-white",
              )}
            >
              <span>{filterLabels[value]}</span>
              <span
                className={cn(
                  "rounded px-1.5 text-[10px] tabular-nums",
                  filter === value ? "bg-black/15 text-black" : "bg-white/5 text-neutral-300",
                )}
              >
                {counts[value]}
              </span>
            </button>
          ))}
        </div>

        {!bugs ? (
          <Card className="border-dashed border-white/10 bg-transparent">
            <CardContent className="grid min-h-32 place-items-center p-6 text-xs text-neutral-500">
              {isLoading ? "Loading…" : "No bugs yet."}
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="border-dashed border-white/10 bg-transparent">
            <CardContent className="grid min-h-32 place-items-center p-6 text-xs text-neutral-500">
              {bugs.length === 0 ? "No bugs reported yet." : "No bugs match this filter."}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filtered.map((bug) => (
              <BugRow
                key={bug.id}
                bug={bug}
                slug={slug}
                onClick={() => {
                  setSelectedBugId(bug.id);
                  setIsDialogOpen(true);
                }}
              />
            ))}
          </div>
        )}
      </section>

      <BugDetailDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        bug={selectedBug}
        slug={slug}
        onBugSave={async (input) => {
          if (!selectedBug) {
            return;
          }
          try {
            const response = await updateAdminBug(slug, selectedBug.id, input);
            setBugs(response.list);
          } catch (nextError) {
            setError(
              nextError instanceof Error ? nextError.message : "Could not update bug.",
            );
            throw nextError;
          }
        }}
        onStateChange={async (state) => {
          if (!selectedBug) {
            return;
          }
          try {
            const response = await updateAdminBug(slug, selectedBug.id, { state });
            setBugs(response.list);
          } catch (nextError) {
            setError(
              nextError instanceof Error ? nextError.message : "Could not update bug state.",
            );
            throw nextError;
          }
        }}
        onCommentCreate={async (description) => {
          if (!selectedBug) {
            return;
          }
          try {
            const response = await createAdminBugComment(slug, selectedBug.id, description);
            setBugs(response.list);
          } catch (nextError) {
            setError(
              nextError instanceof Error ? nextError.message : "Could not send admin reply.",
            );
            throw nextError;
          }
        }}
        onDeleteBug={async () => {
          if (!selectedBug) {
            return;
          }
          try {
            const response = await deleteAdminBug(slug, selectedBug.id);
            setBugs(response.list);
            setIsDialogOpen(false);
            setSelectedBugId(null);
          } catch (nextError) {
            setError(
              nextError instanceof Error ? nextError.message : "Could not delete bug.",
            );
            throw nextError;
          }
        }}
      />
    </DashboardShell>
  );
}

function BugRow({
  bug,
  slug,
  onClick,
}: {
  bug: BugResponse;
  slug: string;
  onClick: () => void;
}) {
  const thumb = bug.screenshotKeys[0];
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-md border border-white/10 bg-neutral-950 p-3 text-left transition hover:border-white/20 hover:bg-white/[0.03]"
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border border-white/10 bg-black">
        {thumb ? (
          <img
            src={bugScreenshotUrl(slug, bug.id, thumb)}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-[10px] uppercase tracking-wider text-neutral-600">N/A</span>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-white">{bug.title}</p>
          <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-300">
            {bugStateLabels[bug.state]}
          </span>
          {bug.screenshotKeys.length > 1 ? (
            <span className="text-[10px] text-neutral-500">
              +{bug.screenshotKeys.length - 1} more
            </span>
          ) : null}
        </div>
        <p className="line-clamp-2 text-xs leading-5 text-neutral-400">{bug.description}</p>
        <div className="flex items-center gap-3 text-[11px] text-neutral-500">
          <span>{formatDate(bug.createdAt)}</span>
          <span>•</span>
          <span>{bug.commentList.length} comments</span>
        </div>
      </div>
    </button>
  );
}
