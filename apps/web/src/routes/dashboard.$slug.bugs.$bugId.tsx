import { createFileRoute } from "@tanstack/react-router";

// Rendered by the bugs page, which opens the bug named in the URL.
export const Route = createFileRoute("/dashboard/$slug/bugs/$bugId")({
  component: () => null,
});
