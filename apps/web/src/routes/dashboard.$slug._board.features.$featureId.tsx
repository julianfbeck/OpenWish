import { createFileRoute } from "@tanstack/react-router";

// Rendered by the board layout, which opens the request named in the URL.
export const Route = createFileRoute("/dashboard/$slug/_board/features/$featureId")({
  component: () => null,
});
