// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  params: { slug: "atlas" } as Record<string, string>,
  pathname: "/dashboard/atlas",
  navigate: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  createAdminBugComment: vi.fn(),
  createAdminComment: vi.fn(),
  createAdminProject: vi.fn(),
  deleteAdminBug: vi.fn(),
  deleteAdminProject: vi.fn(),
  deleteAdminWish: vi.fn(),
  fetchAdminAnalytics: vi.fn(),
  fetchAdminBugs: vi.fn(),
  fetchAdminProject: vi.fn(),
  fetchDashboardSession: vi.fn(),
  loginDashboard: vi.fn(),
  logoutDashboard: vi.fn(),
  mergeAdminWish: vi.fn(),
  updateAdminBug: vi.fn(),
  updateAdminWish: vi.fn(),
  updateProjectSettings: vi.fn(),
  updateWishState: vi.fn(),
}));

const sessionMocks = vi.hoisted(() => ({
  useDashboardSession: vi.fn(),
}));

const navigationMocks = vi.hoisted(() => ({
  assignLocation: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );

  return {
    ...actual,
    Link: ({ children, to, params: _params, search: _search, ...props }: any) => (
      <a href={typeof to === "string" ? to : "#"} {...props}>
        {children}
      </a>
    ),
    Outlet: () => null,
    useNavigate: () => routeState.navigate,
    useParams: () => routeState.params,
    useRouterState: ({ select }: any) =>
      select({ location: { pathname: routeState.pathname } }),
    createFileRoute: () => (options: any) => ({
      ...options,
      options,
      useParams: () => routeState.params,
    }),
  };
});

vi.mock("#/lib/api", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/api")>("../src/lib/api");

  return {
    ...actual,
    createAdminBugComment: apiMocks.createAdminBugComment,
    createAdminComment: apiMocks.createAdminComment,
    createAdminProject: apiMocks.createAdminProject,
    deleteAdminBug: apiMocks.deleteAdminBug,
    deleteAdminProject: apiMocks.deleteAdminProject,
    deleteAdminWish: apiMocks.deleteAdminWish,
    fetchAdminAnalytics: apiMocks.fetchAdminAnalytics,
    fetchAdminBugs: apiMocks.fetchAdminBugs,
    fetchAdminProject: apiMocks.fetchAdminProject,
    fetchDashboardSession: apiMocks.fetchDashboardSession,
    loginDashboard: apiMocks.loginDashboard,
    logoutDashboard: apiMocks.logoutDashboard,
    mergeAdminWish: apiMocks.mergeAdminWish,
    updateAdminBug: apiMocks.updateAdminBug,
    updateAdminWish: apiMocks.updateAdminWish,
    updateProjectSettings: apiMocks.updateProjectSettings,
    updateWishState: apiMocks.updateWishState,
  };
});

vi.mock("#/lib/use-dashboard-session", () => ({
  useDashboardSession: sessionMocks.useDashboardSession,
}));

vi.mock("#/lib/navigation", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/navigation")>("../src/lib/navigation");
  return {
    ...actual,
    assignLocation: navigationMocks.assignLocation,
  };
});

import { DashboardAnalyticsPage } from "../src/routes/dashboard.$slug.analytics";
import { DashboardBoardPage, DashboardSlugRouteLayout } from "../src/routes/dashboard.$slug";
import { DashboardBugsPage } from "../src/routes/dashboard.$slug.bugs";
import { DashboardProjectsPage } from "../src/routes/dashboard.projects";
import { LoginPage } from "../src/routes/login";

const defaultSession = {
  error: null,
  isLoading: false,
  projects: [
    {
      apiKey: "ow_api_atlas",
      createdAt: "2026-04-09T08:00:00.000Z",
      name: "Atlas",
      slug: "atlas",
      watermarkEnabled: false,
    },
  ],
  reloadProjects: vi.fn().mockResolvedValue([]),
  sessionUsername: "admin",
};

const adminProjectResponse = {
  list: [
    {
      commentList: [
        {
          createdAt: "2026-04-09T10:00:00.000Z",
          description: "Needs this soon.",
          id: "comment-1",
          isAdmin: false,
          userId: "22222222-2222-4222-8222-222222222222",
        },
      ],
      description: "Search feedback by account segment.",
      githubLinks: [
        {
          createdAt: "2026-04-09T11:00:00.000Z",
          id: "link-1",
          number: 42,
          repository: "acme/atlas",
          title: "Add segment search",
          type: "pull",
          url: "https://github.com/acme/atlas/pull/42",
        },
      ],
      id: "wish-1",
      platform: "ios",
      state: "pending",
      title: "Faster search",
      userUUID: "11111111-1111-4111-8111-111111111111",
      votingUsers: [{ uuid: "22222222-2222-4222-8222-222222222222" }],
    },
  ],
  project: {
    createdAt: "2026-04-09T08:00:00.000Z",
    name: "Atlas",
    slug: "atlas",
    totalUsers: 4,
    totalVotes: 1,
    totalWishes: 1,
    watermarkEnabled: false,
  },
};

function bugFixture(id: string, title: string, createdAt: string, extra: Record<string, unknown> = {}) {
  return {
    commentList: [],
    context: {},
    createdAt,
    description: `${title} details`,
    githubLinks: [],
    id,
    kind: "bug",
    platform: null,
    reporterEmail: null,
    screenshotKeys: [],
    state: "open",
    title,
    updatedAt: createdAt,
    userUUID: "33333333-3333-4333-8333-333333333333",
    card: null,
    ...extra,
  };
}

const analyticsResponse = {
  project: {
    name: "Atlas",
    slug: "atlas",
  },
  series: [
    { date: "2026-04-07", views: 2 },
    { date: "2026-04-08", views: 5 },
    { date: "2026-04-09", views: 4 },
  ],
  totals: {
    engagementRate: 55,
    featureRequests: 3,
    views: 11,
    votes: 6,
  },
};

describe("web routes", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    routeState.params = { slug: "atlas" };
    routeState.pathname = "/dashboard/atlas";
    routeState.navigate.mockReset();
    window.localStorage.clear();

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        matches: false,
        media: "",
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });

    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    navigationMocks.assignLocation.mockReset();

    sessionMocks.useDashboardSession.mockReset();
    sessionMocks.useDashboardSession.mockReturnValue({
      ...defaultSession,
      reloadProjects: vi.fn().mockResolvedValue(defaultSession.projects),
    });

    for (const mock of Object.values(apiMocks)) {
      mock.mockReset();
    }

    apiMocks.loginDashboard.mockResolvedValue({
      authenticated: true,
      username: "admin",
    });
    apiMocks.createAdminProject.mockResolvedValue({
      adminToken: "ow_admin_new",
      apiKey: "ow_api_new",
      name: "New Atlas",
      slug: "new-atlas",
      watermarkEnabled: false,
    });
    apiMocks.fetchAdminProject.mockResolvedValue(adminProjectResponse);
    apiMocks.fetchAdminAnalytics.mockResolvedValue(analyticsResponse);
  });

  it("logs in and redirects to the requested dashboard page", async () => {
    window.history.replaceState({}, "", "/login?next=%2Fdashboard%2Fprojects");

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret-pass" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(apiMocks.loginDashboard).toHaveBeenCalledWith("admin", "secret-pass");
      expect(navigationMocks.assignLocation).toHaveBeenCalledWith("/dashboard/projects");
    });
  });

  it.each([
    {
      next: "/oauth/authorize?client_id=chatgpt&scope=mcp%3Aread&state=client-state",
      expected: "/oauth/authorize?client_id=chatgpt&scope=mcp%3Aread&state=client-state",
    },
    { next: "https://example.test/escape", expected: "/dashboard/projects" },
    { next: "//example.test/escape", expected: "/dashboard/projects" },
  ])("safely handles the login return path $next", async ({ next, expected }) => {
    window.history.replaceState({}, "", `/login?next=${encodeURIComponent(next)}`);
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-pass" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => {
      expect(apiMocks.loginDashboard).toHaveBeenCalledWith("admin", "secret-pass");
      expect(navigationMocks.assignLocation).toHaveBeenCalledWith(expected);
    });
  });

  it("lands on the last opened project after a login without a return path", async () => {
    window.localStorage.setItem("openwish:last-project-slug", "atlas");
    window.history.replaceState({}, "", "/login");
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-pass" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => {
      expect(navigationMocks.assignLocation).toHaveBeenCalledWith("/dashboard/atlas");
    });
  });

  it("lands on the projects list after login when no project was opened yet", async () => {
    window.history.replaceState({}, "", "/login");
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-pass" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => {
      expect(navigationMocks.assignLocation).toHaveBeenCalledWith("/dashboard/projects");
    });
  });

  it("remembers the project opened in the dashboard and forgets a deleted one", () => {
    routeState.params = { slug: "atlas" };
    const { unmount } = render(<DashboardSlugRouteLayout />);
    expect(window.localStorage.getItem("openwish:last-project-slug")).toBe("atlas");
    unmount();

    routeState.params = { slug: "gone" };
    routeState.pathname = "/dashboard/gone";
    window.localStorage.setItem("openwish:last-project-slug", "gone");
    render(<DashboardSlugRouteLayout />);
    expect(window.localStorage.getItem("openwish:last-project-slug")).toBeNull();
  });

  it("keeps the last opened project selected on the projects page", () => {
    sessionMocks.useDashboardSession.mockReturnValue({
      ...defaultSession,
      projects: [
        ...defaultSession.projects,
        {
          apiKey: "ow_api_beta",
          createdAt: "2026-04-10T08:00:00.000Z",
          name: "Beta",
          slug: "beta",
          watermarkEnabled: false,
        },
      ],
    });
    window.localStorage.setItem("openwish:last-project-slug", "beta");

    render(<DashboardProjectsPage />);

    expect(screen.getByRole("link", { name: "Board" }).getAttribute("href")).toBe(
      "/dashboard/beta",
    );
    expect(screen.getByRole("link", { name: "Bugs" }).getAttribute("href")).toBe(
      "/dashboard/beta/bugs",
    );
  });

  it("renders the projects view and creates a new board", async () => {
    render(<DashboardProjectsPage />);

    expect(screen.getByRole("heading", { name: "Projects" })).toBeTruthy();
    expect(screen.getByText("ow_api_atlas")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "New Atlas" },
    });
    fireEvent.change(screen.getByLabelText("Slug"), {
      target: { value: "new-atlas" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create project/i }));

    await waitFor(() => {
      expect(apiMocks.createAdminProject).toHaveBeenCalledWith({
        name: "New Atlas",
        slug: "new-atlas",
        watermarkEnabled: false,
      });
    });

    expect(navigationMocks.assignLocation).toHaveBeenCalledWith("/dashboard/new-atlas");
  });

  it("renders the board route and opens a request at its own URL", async () => {
    render(<DashboardBoardPage />);

    expect(await screen.findByText("Faster search")).toBeTruthy();
    expect(screen.getByText("iOS")).toBeTruthy();
    expect(screen.getByText("1 GitHub")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /faster search/i }));

    expect(routeState.navigate).toHaveBeenCalledWith({
      to: "/dashboard/$slug/features/$featureId",
      params: { slug: "atlas", featureId: "wish-1" },
      resetScroll: false,
    });
  });

  it("opens the request named in the URL and closes back to the board", async () => {
    routeState.params = { slug: "atlas", featureId: "wish-1" };
    routeState.pathname = "/dashboard/atlas/features/wish-1";
    render(<DashboardBoardPage />);

    expect(await screen.findByRole("button", { name: /update/i })).toBeTruthy();
    expect(screen.getByText("11111111-1111-4111-8111-111111111111")).toBeTruthy();
    expect(screen.getByText("Add segment search").closest("a")?.getAttribute("href")).toBe(
      "https://github.com/acme/atlas/pull/42",
    );
    expect(screen.getByRole("button", { name: /copy link/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(routeState.navigate).toHaveBeenCalledWith({
      to: "/dashboard/$slug",
      params: { slug: "atlas" },
      resetScroll: false,
    });
  });

  it("explains when a linked request no longer exists", async () => {
    routeState.params = { slug: "atlas", featureId: "44444444-4444-4444-8444-444444444444" };
    render(<DashboardBoardPage />);

    expect(await screen.findByText(/feature request no longer exists/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /update/i })).toBeNull();
  });

  it("lists bugs newest first with their platform", async () => {
    apiMocks.fetchAdminBugs.mockResolvedValue({
      list: [
        bugFixture("bug-mid", "Middle bug", "2026-04-08T12:00:00.000Z"),
        bugFixture("bug-new", "Newest bug", "2026-04-09T09:30:00.000Z", { platform: "android" }),
        bugFixture("bug-old", "Oldest bug", "2026-04-01T08:00:00.000Z", { platform: "ios" }),
      ],
    });
    routeState.pathname = "/dashboard/atlas/bugs";
    render(<DashboardBugsPage />);

    await screen.findByText("Newest bug");
    const titles = screen
      .getAllByRole("button")
      .map((button) => button.textContent ?? "")
      .filter((text) => text.includes(" bug"))
      .map((text) => text.match(/(Newest|Middle|Oldest) bug/)?.[0]);
    expect(titles).toEqual(["Newest bug", "Middle bug", "Oldest bug"]);
    expect(screen.getByText("Android")).toBeTruthy();
    expect(screen.getByText("iOS")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /middle bug/i }));
    expect(routeState.navigate).toHaveBeenCalledWith({
      to: "/dashboard/$slug/bugs/$bugId",
      params: { slug: "atlas", bugId: "bug-mid" },
      resetScroll: false,
    });
  });

  it("opens a bug from its URL even when it is outside the current filter", async () => {
    apiMocks.fetchAdminBugs.mockResolvedValue({
      list: [
        bugFixture("bug-open", "Open bug", "2026-04-09T09:30:00.000Z"),
        bugFixture("bug-fixed", "Fixed crash", "2026-04-02T09:30:00.000Z", { state: "fixed" }),
      ],
    });
    routeState.params = { slug: "atlas", bugId: "bug-fixed" };
    routeState.pathname = "/dashboard/atlas/bugs/bug-fixed";
    render(<DashboardBugsPage />);

    expect(await screen.findByDisplayValue("Fixed crash")).toBeTruthy();
    // The list behind the (modal) dialog switched to the bug's state.
    expect(screen.getByRole("button", { name: /fixed crash/i, hidden: true })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /open bug/i, hidden: true })).toBeNull();
  });

  it("renders the analytics route with summary cards", async () => {
    render(<DashboardAnalyticsPage />);

    expect(await screen.findByRole("heading", { name: "Analytics" })).toBeTruthy();
    expect(screen.getByText("11")).toBeTruthy();
    expect(screen.getByText("55.00%")).toBeTruthy();
  });
});
