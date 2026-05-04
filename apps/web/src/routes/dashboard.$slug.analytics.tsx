import { useEffect, useState } from "react";

import type { AdminAnalyticsResponse } from "@openwish/shared";
import { createFileRoute, Link } from "@tanstack/react-router";

import { AnalyticsLineChart } from "#/components/analytics-line-chart";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { DashboardShell } from "#/components/dashboard-shell";
import { ApiRequestError, fetchAdminAnalytics } from "#/lib/api";
import { formatPercent } from "#/lib/format";
import { assignLocation } from "#/lib/navigation";
import { useDashboardSession } from "#/lib/use-dashboard-session";

export const Route = createFileRoute("/dashboard/$slug/analytics")({
  component: DashboardAnalyticsPage,
});

export function DashboardAnalyticsPage() {
  const { slug } = Route.useParams();
  const { error: sessionError, isLoading, projects, sessionUsername } = useDashboardSession();
  const [data, setData] = useState<AdminAnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAnalytics() {
      try {
        setError(null);
        const response = await fetchAdminAnalytics(slug);
        if (!cancelled) {
          setData(response);
        }
      } catch (nextError) {
        if (cancelled) {
          return;
        }

        if (nextError instanceof ApiRequestError && nextError.status === 401) {
          assignLocation(`/login?next=${encodeURIComponent(window.location.pathname)}`);
          return;
        }

        setError(nextError instanceof Error ? nextError.message : "Could not load analytics.");
      }
    }

    void loadAnalytics();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const projectName = data?.project.name ?? projects.find((project) => project.slug === slug)?.name;

  return (
    <DashboardShell
      active="analytics"
      projects={projects}
      sessionUsername={sessionUsername}
      projectName={projectName}
      projectSlug={slug}
      actions={
        <Button
          asChild
          variant="outline"
          size="sm"
          className="border-white/10 bg-transparent text-neutral-300 hover:bg-white/5 hover:text-white"
        >
          <Link to="/dashboard/$slug" params={{ slug }}>
            Back to board
          </Link>
        </Button>
      }
    >
      <section className="space-y-5">
        {sessionError || error ? (
          <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error ?? sessionError}
          </div>
        ) : null}

        {!data ? (
          <Card className="border-dashed border-white/10 bg-transparent">
            <CardContent className="grid min-h-48 place-items-center p-6 text-xs text-neutral-500">
              {isLoading ? "Loading…" : "No analytics yet."}
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Views", value: data.totals.views },
                { label: "Votes", value: data.totals.votes },
                { label: "Feature requests", value: data.totals.featureRequests },
                { label: "Engagement rate", value: formatPercent(data.totals.engagementRate) },
              ].map(({ label, value }) => (
                <Card key={label} className="border-white/10 bg-neutral-950">
                  <CardContent className="space-y-1 p-4">
                    <p className="text-[11px] uppercase tracking-wider text-neutral-500">
                      {label}
                    </p>
                    <p className="text-2xl font-medium text-white">{value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <AnalyticsLineChart points={data.series} />
          </>
        )}
      </section>
    </DashboardShell>
  );
}
