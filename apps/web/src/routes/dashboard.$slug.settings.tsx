import { useEffect, useState } from "react";

import type { AdminProjectResponse } from "@openwish/shared";
import { AlertTriangle, Trash2 } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";

import { DashboardShell } from "#/components/dashboard-shell";
import {
  AppLinkSettings,
  NotificationSettings,
  PublicFormSettings,
} from "#/components/project-settings";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import {
  ApiRequestError,
  deleteAdminProject,
  fetchAdminProject,
} from "#/lib/api";
import { assignLocation } from "#/lib/navigation";
import { useDashboardSession } from "#/lib/use-dashboard-session";

export const Route = createFileRoute("/dashboard/$slug/settings")({
  component: DashboardSettingsPage,
});

function DashboardSettingsPage() {
  const { slug } = Route.useParams();
  const { error: sessionError, isLoading, projects, sessionUsername } = useDashboardSession();
  const [data, setData] = useState<AdminProjectResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setError(null);
        const response = await fetchAdminProject(slug);
        if (!cancelled) setData(response);
      } catch (nextError) {
        if (cancelled) return;
        if (nextError instanceof ApiRequestError && nextError.status === 401) {
          assignLocation(`/login?next=${encodeURIComponent(window.location.pathname)}`);
          return;
        }
        setError(
          nextError instanceof Error ? nextError.message : "Could not load project.",
        );
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const projectName =
    data?.project.name ?? projects.find((project) => project.slug === slug)?.name;
  const projectIconUrl =
    data?.project.appIconUrl ??
    projects.find((project) => project.slug === slug)?.appIconUrl ??
    null;

  return (
    <DashboardShell
      active="settings"
      projects={projects}
      sessionUsername={sessionUsername}
      projectName={projectName}
      projectSlug={slug}
      projectIconUrl={projectIconUrl}
    >
      <section className="space-y-5">
        {sessionError || error ? (
          <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {sessionError ?? error}
          </div>
        ) : null}

        {isLoading || !data ? (
          <Card className="border-white/10 bg-neutral-950">
            <CardContent className="py-10 text-center text-sm text-neutral-500">
              Loading…
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-white">General</h2>
              <AppLinkSettings
                slug={slug}
                currentUrl={data.project.appStoreUrl ?? null}
                appName={data.project.appName ?? null}
                appIconUrl={data.project.appIconUrl ?? null}
                onSaved={(next) => setData(next)}
              />
            </div>

            <div className="space-y-3">
              <h2 className="text-sm font-medium text-white">Notifications</h2>
              <NotificationSettings
                slug={slug}
                currentEmail={data.project.notificationEmail ?? null}
                onSaved={(next) => setData(next)}
              />
            </div>

            <div className="space-y-3">
              <h2 className="text-sm font-medium text-white">Public feedback page</h2>
              <PublicFormSettings
                slug={slug}
                enabled={Boolean(data.project.publicFormEnabled)}
                onSaved={(next) => setData(next)}
              />
            </div>

            <div className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-medium text-red-300">
                <AlertTriangle className="size-4" />
                Danger zone
              </h2>
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-red-500/20 bg-red-500/5 px-4 py-3">
                <span className="flex-1 text-xs text-neutral-300">
                  Delete this project. Wishes, bugs, votes, comments, and screenshots
                  are removed and cannot be recovered.
                </span>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-500/30 bg-transparent text-red-300 hover:bg-red-500/10 hover:text-red-200"
                    >
                      <Trash2 className="mr-1.5 size-3.5" />
                      Delete project
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="border-white/10 bg-neutral-950 text-neutral-100">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {projectName}?</AlertDialogTitle>
                      <AlertDialogDescription className="text-neutral-400">
                        This permanently removes the project and all its data.
                        SDK clients with this API key will start receiving 401s.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="border-white/10 bg-transparent text-neutral-300 hover:bg-white/5 hover:text-white">
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-red-500 text-white hover:bg-red-600"
                        onClick={async () => {
                          setIsDeleting(true);
                          try {
                            await deleteAdminProject(slug);
                            assignLocation("/dashboard/projects");
                          } catch (nextError) {
                            setError(
                              nextError instanceof Error
                                ? nextError.message
                                : "Could not delete project.",
                            );
                          } finally {
                            setIsDeleting(false);
                          }
                        }}
                      >
                        {isDeleting ? "Deleting…" : "Delete"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </>
        )}
      </section>
    </DashboardShell>
  );
}
