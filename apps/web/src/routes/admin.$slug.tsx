import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/$slug")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/dashboard/$slug",
      params,
    });
  },
  component: LegacyAdminRedirect,
});

function LegacyAdminRedirect() {
  return null;
}
