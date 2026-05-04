// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  fetchAdminProjects: vi.fn(),
  fetchDashboardSession: vi.fn(),
}));

vi.mock("#/lib/api", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/api")>("../src/lib/api");

  return {
    ...actual,
    fetchAdminProjects: apiMocks.fetchAdminProjects,
    fetchDashboardSession: apiMocks.fetchDashboardSession,
  };
});

const navigationMocks = vi.hoisted(() => ({
  assignLocation: vi.fn(),
}));

vi.mock("#/lib/navigation", () => ({
  assignLocation: navigationMocks.assignLocation,
}));

import { ApiRequestError } from "../src/lib/api";
import { useDashboardSession } from "../src/lib/use-dashboard-session";

function SessionProbe() {
  const state = useDashboardSession();

  return (
    <div>
      <span>{state.sessionUsername}</span>
      <span>{state.projects.length}</span>
    </div>
  );
}

describe("dashboard session hook", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    apiMocks.fetchAdminProjects.mockReset();
    apiMocks.fetchDashboardSession.mockReset();
    navigationMocks.assignLocation.mockReset();
    window.history.replaceState({}, "", "/dashboard/projects");
  });

  it("redirects unauthenticated dashboard requests to login once", async () => {
    apiMocks.fetchDashboardSession.mockRejectedValue(
      new ApiRequestError("Dashboard login required.", 401),
    );

    render(<SessionProbe />);

    await waitFor(() => {
      expect(navigationMocks.assignLocation).toHaveBeenCalledWith(
        "/login?next=%2Fdashboard%2Fprojects",
      );
    });

    expect(navigationMocks.assignLocation).toHaveBeenCalledTimes(1);
    expect(apiMocks.fetchAdminProjects).not.toHaveBeenCalled();
  });
});
