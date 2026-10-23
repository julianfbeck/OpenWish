import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/$slug/_board/")({
  component: () => null,
});
