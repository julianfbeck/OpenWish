import { createFileRoute } from "@tanstack/react-router";

import { DashboardBoardPage } from "./dashboard.$slug";

// Pathless layout: the board (/dashboard/<slug>) and a request's detail URL
// (/dashboard/<slug>/features/<id>) share one mounted board, so opening a
// request does not reload the board.
export const Route = createFileRoute("/dashboard/$slug/_board")({
  component: DashboardBoardPage,
});
