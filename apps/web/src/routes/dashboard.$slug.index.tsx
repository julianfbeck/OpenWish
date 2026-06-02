import { createFileRoute } from "@tanstack/react-router";

import { DashboardBoardPage } from "./dashboard.$slug";

export const Route = createFileRoute("/dashboard/$slug/")({
  component: DashboardBoardPage,
});
