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

export function useDashboardSession(): DashboardSessionState {
  const [sessionUsername, setSessionUsername] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reloadProjects() {
    const response = await fetchAdminProjects();
    setProjects(response.projects);
    return response.projects;
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const session = await fetchDashboardSession();
        if (cancelled) {
          return;
        }

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
