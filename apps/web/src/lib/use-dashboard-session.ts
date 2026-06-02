import { useEffect, useState } from "react";

import type { ProjectSummary } from "@openwish/shared";

import {
  ApiRequestError,
  fetchAdminProjects,
  fetchDashboardSession,
} from "#/lib/api";
import { assignLocation } from "#/lib/navigation";

type DashboardSessionState = {
  error: string | null;
  isLoading: boolean;
  projects: ProjectSummary[];
  sessionUsername: string;
  reloadProjects: () => Promise<ProjectSummary[]>;
};

// Module-level cache so the session/projects survive client-side navigation
// between dashboard tabs. Each tab is its own route, so without this the hook
// remounts with empty state and the project switcher flickers out until the
// refetch lands. A full reload (logout / 401 redirect) clears module state.
let projectsCache: ProjectSummary[] | null = null;
let usernameCache = "";

export function useDashboardSession(): DashboardSessionState {
  const [sessionUsername, setSessionUsername] = useState(usernameCache);
  const [projects, setProjects] = useState<ProjectSummary[]>(projectsCache ?? []);
  const [isLoading, setIsLoading] = useState(projectsCache === null);
  const [error, setError] = useState<string | null>(null);

  async function reloadProjects() {
    const response = await fetchAdminProjects();
    projectsCache = response.projects;
    setProjects(response.projects);
    return response.projects;
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Only show the blocking loading state on the very first load; later
      // navigations already have cached data and refresh in the background.
      if (projectsCache === null) {
        setIsLoading(true);
      }
      setError(null);

      try {
        const session = await fetchDashboardSession();
        if (cancelled) {
          return;
        }

        usernameCache = session.username;
        setSessionUsername(session.username);
        await reloadProjects();
      } catch (nextError) {
        if (cancelled) {
          return;
        }

        if (nextError instanceof ApiRequestError && nextError.status === 401) {
          assignLocation(`/login?next=${encodeURIComponent(window.location.pathname)}`);
          return;
        }

        setError(nextError instanceof Error ? nextError.message : "Could not load dashboard.");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    error,
    isLoading,
    projects,
    sessionUsername,
    reloadProjects,
  };
}
