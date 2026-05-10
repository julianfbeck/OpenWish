import { useEffect, useMemo, useState } from "react";

import type { AdminProjectResponse, WishState } from "@openwish/shared";
import { wishStateLabels } from "@openwish/shared";
import { Outlet, createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { Download, Layers3, List } from "lucide-react";

import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { DashboardShell } from "#/components/dashboard-shell";
import { RequestDetailDialog } from "#/components/request-detail-dialog";
import {
  ApiRequestError,
  createAdminComment,
  deleteAdminWish,
  fetchAdminProject,
  mergeAdminWish,
  updateAdminWish,
  updateWishState,
} from "#/lib/api";
import { assignLocation } from "#/lib/navigation";
import { useDashboardSession } from "#/lib/use-dashboard-session";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/dashboard/$slug")({
  component: DashboardSlugRouteLayout,
});

type ViewMode = "board" | "rows";

const columns: Array<{
  key: string;
  label: string;
  states: WishState[];
}> = [
  { key: "pending", label: "Pending", states: ["pending"] },
  { key: "review", label: "In review", states: ["inReview", "approved"] },
  { key: "planned", label: "Planned", states: ["planned"] },
  { key: "progress", label: "In progress", states: ["inProgress"] },
  { key: "completed", label: "Completed", states: ["completed", "implemented"] },
];

function buildCsv(data: AdminProjectResponse) {
  return [
    ["state", "title", "description", "votes", "comments"],
    ...data.list.map((wish) => [
      wish.state,
      wish.title,
      wish.description,
      String(wish.votingUsers.length),
      String(wish.commentList.length),
    ]),
  ]
    .map((row) => row.map((value) => `"${value.replaceAll("\"", "\"\"")}"`).join(","))
    .join("\n");
}

function DashboardSlugRouteLayout() {
  const { slug } = Route.useParams();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  if (pathname !== `/dashboard/${slug}`) {
    return <Outlet />;
  }

  return <DashboardBoardPage />;
}

function WishCard({
  wish,
  selected,
  onClick,
  showState,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  wish: AdminProjectResponse["list"][number];
  selected: boolean;
  onClick: () => void;
  showState?: boolean;
  onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={Boolean(onDragStart)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-md border p-2.5 text-left transition",
        "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
        selected
          ? "border-white/25 bg-white/5"
          : "border-white/10 bg-neutral-950 hover:border-white/20 hover:bg-white/[0.03]",
      )}
    >
      <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded border border-white/10 bg-black leading-none">
        <span className="text-sm font-semibold text-white">{wish.votingUsers.length}</span>
        <span className="mt-0.5 text-[8px] uppercase tracking-wider text-neutral-500">votes</span>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-medium text-white">{wish.title}</p>
          {showState ? (
            <span className="shrink-0 text-[11px] text-neutral-500">
              {wishStateLabels[wish.state]}
            </span>
          ) : null}
        </div>
        <p className="line-clamp-2 text-xs leading-5 text-neutral-400">{wish.description}</p>
      </div>
    </div>
  );
}

export function DashboardBoardPage() {
  const { slug } = Route.useParams();
  const { error: sessionError, isLoading, projects, sessionUsername } = useDashboardSession();
  const [data, setData] = useState<AdminProjectResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [selectedWishId, setSelectedWishId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [draggingWishId, setDraggingWishId] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);

  const selectedWish = data?.list.find((wish) => wish.id === selectedWishId) ?? null;

  const groupedColumns = useMemo(
    () =>
      columns.map((column) => ({
        ...column,
        wishes:
          data?.list
            .filter((wish) => column.states.includes(wish.state))
            .sort((left, right) => right.votingUsers.length - left.votingUsers.length) ?? [],
      })),
    [data],
  );

  useEffect(() => {
    if (!slug) {
      return;
    }

    let cancelled = false;

    async function loadProject() {
      try {
        setError(null);
        const response = await fetchAdminProject(slug);
        if (cancelled) {
          return;
        }

        setData(response);
        setSelectedWishId((current) =>
          current && response.list.some((wish) => wish.id === current)
            ? current
            : (response.list[0]?.id ?? null),
        );
      } catch (nextError) {
        if (cancelled) {
          return;
        }

        if (nextError instanceof ApiRequestError && nextError.status === 401) {
          assignLocation(`/login?next=${encodeURIComponent(window.location.pathname)}`);
          return;
        }

        setError(nextError instanceof Error ? nextError.message : "Could not load project.");
      }
    }

    void loadProject();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function handleDropOnColumn(targetState: WishState) {
    const wishId = draggingWishId;
    setDraggingWishId(null);
    setDropTargetKey(null);
    if (!wishId || !data) {
      return;
    }
    const wish = data.list.find((entry) => entry.id === wishId);
    if (!wish || wish.state === targetState) {
      return;
    }
    // Optimistic — patch the local state immediately so the card snaps into the new column.
    setData({
      ...data,
      list: data.list.map((entry) =>
        entry.id === wishId ? { ...entry, state: targetState } : entry,
      ),
    });
    try {
      const response = await updateWishState(slug, wishId, targetState);
      setData(response);
    } catch (nextError) {
      // Roll back by re-fetching.
      try {
        const fresh = await fetchAdminProject(slug);
        setData(fresh);
      } catch {
        // ignore — the next manual reload picks up the truth.
      }
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not move request between states.",
      );
    }
  }

  return (
    <DashboardShell
      active="board"
      projects={projects}
      sessionUsername={sessionUsername}
      projectName={data?.project.name ?? projects.find((project) => project.slug === slug)?.name}
      projectIconUrl={data?.project.appIconUrl ?? projects.find((project) => project.slug === slug)?.appIconUrl ?? null}
      projectSlug={slug}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-white/10 bg-transparent text-neutral-300 hover:bg-white/5 hover:text-white"
            disabled={!data}
            onClick={() => {
              if (!data) {
                return;
              }

              const blob = new Blob([buildCsv(data)], { type: "text/csv;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = `${data.project.slug}-feedback.csv`;
              anchor.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="size-3.5" />
            Export
          </Button>

          <div className="inline-flex rounded-md border border-white/10 p-0.5">
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs transition-colors",
                viewMode === "board"
                  ? "bg-white text-black"
                  : "text-neutral-400 hover:text-white",
              )}
              onClick={() => setViewMode("board")}
            >
              <Layers3 className="size-3.5" />
              Board
            </button>
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs transition-colors",
                viewMode === "rows"
                  ? "bg-white text-black"
                  : "text-neutral-400 hover:text-white",
              )}
              onClick={() => setViewMode("rows")}
            >
              <List className="size-3.5" />
              Rows
            </button>
          </div>
        </div>
      }
    >
      <section className="space-y-4">
        {sessionError || error ? (
          <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error ?? sessionError}
          </div>
        ) : null}

        {!data ? (
          <Card className="border-dashed border-white/10 bg-transparent">
            <CardContent className="grid min-h-32 place-items-center p-6 text-xs text-neutral-500">
              {isLoading ? "Loading…" : "No project data yet."}
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-white/10 bg-neutral-950 px-4 py-3">
              {[
                ["Requests", data.project.totalWishes],
                ["Votes", data.project.totalVotes],
                ["Users", data.project.totalUsers],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline gap-2">
                  <span className="text-[11px] uppercase tracking-wider text-neutral-500">
                    {label}
                  </span>
                  <span className="text-base font-medium tabular-nums text-white">{value}</span>
                </div>
              ))}
              <Link
                to="/dashboard/$slug/analytics"
                params={{ slug }}
                className="ml-auto text-xs text-neutral-400 hover:text-white"
              >
                Analytics →
              </Link>
            </div>


            {viewMode === "board" ? (
              <div className="overflow-x-auto pb-2">
                <div className="grid min-w-[1100px] grid-cols-5 items-start gap-3">
                  {groupedColumns.map((column) => {
                    const targetState = column.states[0] as WishState;
                    const isDropTarget = dropTargetKey === column.key;
                    return (
                      <div
                        key={column.key}
                        onDragOver={(event) => {
                          if (!draggingWishId) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          if (dropTargetKey !== column.key) {
                            setDropTargetKey(column.key);
                          }
                        }}
                        onDragLeave={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                            setDropTargetKey((current) =>
                              current === column.key ? null : current,
                            );
                          }
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          void handleDropOnColumn(targetState);
                        }}
                        className={cn(
                          "rounded-md border bg-neutral-950 transition-colors",
                          isDropTarget
                            ? "border-white/40 bg-white/[0.04]"
                            : "border-white/10",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
                          <span className="text-[11px] uppercase tracking-wider text-neutral-400">
                            {column.label}
                          </span>
                          <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] tabular-nums text-neutral-400">
                            {column.wishes.length}
                          </span>
                        </div>

                        <div className="space-y-2 p-2">
                          {column.wishes.length === 0 ? (
                            <div
                              className={cn(
                                "grid min-h-12 place-items-center rounded text-center text-[11px] transition-colors",
                                isDropTarget
                                  ? "border border-dashed border-white/30 text-neutral-300"
                                  : "text-neutral-600",
                              )}
                            >
                              {isDropTarget && draggingWishId ? "Drop here" : "Empty"}
                            </div>
                          ) : (
                            column.wishes.map((wish) => (
                              <WishCard
                                key={wish.id}
                                wish={wish}
                                selected={selectedWishId === wish.id}
                                isDragging={draggingWishId === wish.id}
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = "move";
                                  event.dataTransfer.setData("text/plain", wish.id);
                                  setDraggingWishId(wish.id);
                                }}
                                onDragEnd={() => {
                                  setDraggingWishId(null);
                                  setDropTargetKey(null);
                                }}
                                onClick={() => {
                                  setSelectedWishId(wish.id);
                                  setIsDialogOpen(true);
                                }}
                              />
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {groupedColumns
                  .filter((column) => column.wishes.length > 0)
                  .map((column) => (
                    <div key={column.key} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] uppercase tracking-wider text-neutral-400">
                          {column.label}
                        </span>
                        <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] tabular-nums text-neutral-400">
                          {column.wishes.length}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {column.wishes.map((wish) => (
                          <WishCard
                            key={wish.id}
                            wish={wish}
                            selected={selectedWishId === wish.id}
                            showState
                            onClick={() => {
                              setSelectedWishId(wish.id);
                              setIsDialogOpen(true);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                {groupedColumns.every((column) => column.wishes.length === 0) ? (
                  <div className="rounded-md border border-dashed border-white/10 px-4 py-10 text-center text-xs text-neutral-500">
                    No requests yet.
                  </div>
                ) : null}
              </div>
            )}
          </>
        )}
      </section>

      <RequestDetailDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        wish={selectedWish}
        allWishes={data?.list ?? []}
        projectCreatedAt={data?.project.createdAt}
        onStateChange={async (state) => {
          if (!selectedWish) {
            return;
          }

          try {
            const response = await updateWishState(slug, selectedWish.id, state);
            setData(response);
          } catch (nextError) {
            setError(
              nextError instanceof Error ? nextError.message : "Could not update request state.",
            );
            throw nextError;
          }
        }}
        onWishSave={async (input) => {
          if (!selectedWish) {
            return;
          }

          try {
            const response = await updateAdminWish(slug, selectedWish.id, input);
            setData(response);
          } catch (nextError) {
            setError(
              nextError instanceof Error ? nextError.message : "Could not update request.",
            );
            throw nextError;
          }
        }}
        onCommentCreate={async (description) => {
          if (!selectedWish) {
            return;
          }

          try {
            const response = await createAdminComment(slug, selectedWish.id, description);
            setData(response);
          } catch (nextError) {
            setError(
              nextError instanceof Error ? nextError.message : "Could not send admin note.",
            );
            throw nextError;
          }
        }}
        onMergeWish={async (targetWishId) => {
          if (!selectedWish) {
            return;
          }

          try {
            const response = await mergeAdminWish(slug, selectedWish.id, targetWishId);
            setData(response);
            setSelectedWishId(targetWishId);
          } catch (nextError) {
            setError(
              nextError instanceof Error ? nextError.message : "Could not merge request.",
            );
            throw nextError;
          }
        }}
        onDeleteWish={async () => {
          if (!selectedWish) {
            return;
          }

          try {
            const response = await deleteAdminWish(slug, selectedWish.id);
            setData(response);
            setSelectedWishId(response.list[0]?.id ?? null);
            setIsDialogOpen(false);
          } catch (nextError) {
            setError(
              nextError instanceof Error ? nextError.message : "Could not delete request.",
            );
            throw nextError;
          }
        }}
      />
    </DashboardShell>
  );
}

