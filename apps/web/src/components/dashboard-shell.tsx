import type { ReactNode } from "react";

import type { ProjectSummary } from "@openwish/shared";
import { Link } from "@tanstack/react-router";
import { BarChart3, Bug, FolderKanban, LayoutPanelTop, Settings } from "lucide-react";

import { Button } from "#/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { logoutDashboard } from "#/lib/api";
import { assignLocation } from "#/lib/navigation";
import { cn } from "#/lib/utils";

type DashboardShellProps = {
  active: "board" | "bugs" | "analytics" | "settings" | "projects";
  children: ReactNode;
  actions?: ReactNode;
  sessionUsername: string;
  projectName?: string;
  projectSlug?: string;
  projectIconUrl?: string | null;
  projects: ProjectSummary[];
};

function navClass(isActive: boolean) {
  return cn(
    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
    isActive
      ? "bg-white/10 text-white"
      : "text-neutral-500 hover:bg-white/5 hover:text-white",
  );
}

function dashboardHref(projectSlug?: string) {
  return projectSlug ? `/dashboard/${projectSlug}` : "/dashboard/projects";
}

function analyticsHref(projectSlug?: string) {
  return projectSlug ? `/dashboard/${projectSlug}/analytics` : "/dashboard/projects";
}

function bugsHref(projectSlug?: string) {
  return projectSlug ? `/dashboard/${projectSlug}/bugs` : "/dashboard/projects";
}

function settingsHref(projectSlug?: string) {
  return projectSlug ? `/dashboard/${projectSlug}/settings` : "/dashboard/projects";
}

function hrefForActive(active: DashboardShellProps["active"], slug: string) {
  switch (active) {
    case "board":
      return `/dashboard/${slug}`;
    case "bugs":
      return `/dashboard/${slug}/bugs`;
    case "analytics":
      return `/dashboard/${slug}/analytics`;
    case "settings":
      return `/dashboard/${slug}/settings`;
    case "projects":
      return `/dashboard/${slug}`;
  }
}

export function DashboardShell({
  active,
  children,
  actions,
  sessionUsername,
  projectName,
  projectSlug,
  projectIconUrl,
  projects,
}: DashboardShellProps) {
  const selectValue =
    projectSlug && projects.some((project) => project.slug === projectSlug)
      ? projectSlug
      : undefined;
  const activeIconUrl =
    projectIconUrl ??
    (selectValue
      ? (projects.find((project) => project.slug === selectValue)?.appIconUrl ?? null)
      : null);

  return (
    <main className="min-h-screen bg-black text-neutral-100">
      <div className="grid min-h-screen lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="border-b border-white/10 px-5 py-6 lg:border-b-0 lg:border-r">
          <Link to="/dashboard/projects" className="flex items-center gap-2">
            <img
              src="/openwish-icon-dark-192.png"
              alt=""
              className="size-7 rounded-md"
            />
            <span className="text-sm font-medium tracking-tight text-white">OpenWish</span>
          </Link>

          {projects.length > 0 ? (
            <div className="mt-6 space-y-1.5">
              <p className="text-[11px] uppercase tracking-wider text-neutral-500">
                Project
              </p>
              <Select
                value={selectValue}
                onValueChange={(next) => assignLocation(hrefForActive(active, next))}
              >
                <SelectTrigger
                  size="sm"
                  className="h-9 w-full border-white/10 bg-neutral-950 text-sm text-neutral-100"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {activeIconUrl ? (
                      <img
                        src={activeIconUrl}
                        alt=""
                        className="size-5 shrink-0 rounded-sm border border-white/10"
                      />
                    ) : null}
                    <SelectValue placeholder={projectName ?? "Select project"} />
                  </span>
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-neutral-950 text-neutral-100">
                  {projects.map((project) => (
                    <SelectItem key={project.slug} value={project.slug}>
                      <span className="flex items-center gap-2">
                        {project.appIconUrl ? (
                          <img
                            src={project.appIconUrl}
                            alt=""
                            className="size-4 rounded-sm border border-white/10"
                          />
                        ) : null}
                        {project.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <nav className="mt-6 space-y-1">
            <Link className={navClass(active === "board")} to={dashboardHref(projectSlug)}>
              <LayoutPanelTop className="size-4" />
              Board
            </Link>
            <Link className={navClass(active === "bugs")} to={bugsHref(projectSlug)}>
              <Bug className="size-4" />
              Bugs
            </Link>
            <Link className={navClass(active === "analytics")} to={analyticsHref(projectSlug)}>
              <BarChart3 className="size-4" />
              Analytics
            </Link>
            <Link className={navClass(active === "settings")} to={settingsHref(projectSlug)}>
              <Settings className="size-4" />
              Settings
            </Link>
            <Link className={navClass(active === "projects")} to="/dashboard/projects">
              <FolderKanban className="size-4" />
              Projects
            </Link>
          </nav>

          <div className="mt-8 border-t border-white/10 pt-4">
            <p className="text-[11px] uppercase tracking-wider text-neutral-500">Session</p>
            <p className="mt-2 truncate text-sm text-white">{sessionUsername || "admin"}</p>
          </div>
        </aside>

        <section className="min-w-0 px-5 py-6 sm:px-8">
          <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-lg font-medium tracking-tight text-white">
              {active === "board"
                ? "Board"
                : active === "bugs"
                  ? "Bugs"
                  : active === "analytics"
                    ? "Analytics"
                    : active === "settings"
                      ? "Settings"
                      : "Projects"}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              {actions}
              <Button
                variant="outline"
                size="sm"
                className="border-white/10 bg-transparent text-neutral-300 hover:bg-white/5 hover:text-white"
                onClick={async () => {
                  try {
                    await logoutDashboard();
                  } finally {
                    assignLocation("/login");
                  }
                }}
              >
                Logout
              </Button>
            </div>
          </header>

          {children}
        </section>
      </div>
    </main>
  );
}
