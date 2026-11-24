import type { BugResponse, WishResponse } from "@openwish/shared";

// Pure helpers behind the MCP read tools (filters, paging, compact rows, id
// prefixes, reporter history). They work on the lists the dashboard loaders
// return, so they add no SQL and never touch SDK responses.

export type Resolved<T> =
  | { status: "found"; item: T }
  | { status: "ambiguous"; matches: T[] }
  | { status: "missing" };

export function resolveIdPrefix<T extends { id: string }>(items: T[], idOrPrefix: string): Resolved<T> {
  const needle = idOrPrefix.trim().toLowerCase();
  const exact = items.find((item) => item.id.toLowerCase() === needle);
  if (exact) return { status: "found", item: exact };
  const matches = items.filter((item) => item.id.toLowerCase().startsWith(needle));
  if (matches.length === 1) return { status: "found", item: matches[0]! };
  return matches.length ? { status: "ambiguous", matches } : { status: "missing" };
}

function group(context: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = context[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function appVersionOf(issue: BugResponse): string | null {
  const version = group(issue.context, "app")?.version;
  return typeof version === "string" && version !== "unknown" ? version : null;
}

export function osVersionOf(issue: BugResponse): string | null {
  const device = group(issue.context, "device");
  const value = device?.androidVersion ?? device?.os;
  return typeof value === "string" ? value : null;
}

export function revenueCatIdOf(context: Record<string, unknown>): string | null {
  const value = group(context, "revenueCat")?.appUserId;
  return typeof value === "string" && value ? value : null;
}

export type IssueFilter = {
  state?: string[];
  kind?: string;
  platform?: string;
  appVersion?: string;
  query?: string;
  since?: string;
  adminReplied?: boolean;
};

export function filterIssues(list: BugResponse[], filter: IssueFilter): BugResponse[] {
  const query = filter.query?.trim().toLowerCase();
  const since = filter.since ? Date.parse(filter.since) : Number.NaN;
  return list.filter((issue) => {
    if (filter.state?.length && !filter.state.includes(issue.state)) return false;
    if (filter.kind && issue.kind !== filter.kind) return false;
    if (filter.platform && (issue.platform ?? "unknown") !== filter.platform) return false;
    if (filter.appVersion && appVersionOf(issue) !== filter.appVersion) return false;
    if (!Number.isNaN(since) && Date.parse(issue.createdAt) < since) return false;
    if (filter.adminReplied !== undefined && issue.commentList.some((comment) => comment.isAdmin) !== filter.adminReplied) {
      return false;
    }
    if (query) {
      const haystack = [issue.id, issue.title, issue.description, issue.card?.name ?? "", issue.reporterEmail ?? ""]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function compactIssue(issue: BugResponse) {
  return {
    id: issue.id,
    shortId: issue.id.slice(0, 8),
    title: issue.title,
    state: issue.state,
    kind: issue.kind,
    platform: issue.platform ?? null,
    appVersion: appVersionOf(issue),
    createdAt: issue.createdAt,
    comments: issue.commentList.length,
    adminReplied: issue.commentList.some((comment) => comment.isAdmin),
    screenshots: issue.screenshotKeys.length,
    card: issue.card?.name ?? null,
  };
}

export function compactFeature(feature: WishResponse) {
  return {
    id: feature.id,
    shortId: feature.id.slice(0, 8),
    title: feature.title,
    state: feature.state,
    platform: feature.platform ?? null,
    votes: feature.votingUsers.length,
    comments: feature.commentList.length,
  };
}

export function paginate<T>(list: T[], limit: number | undefined, offset = 0) {
  const start = Math.max(0, offset);
  const items = limit === undefined ? list.slice(start) : list.slice(start, start + limit);
  const next = start + items.length;
  return { items, total: list.length, nextOffset: next < list.length ? next : null };
}

export function issueStats(list: BugResponse[]) {
  const count = (key: (issue: BugResponse) => string) => {
    const counts = new Map<string, number>();
    for (const issue of list) counts.set(key(issue), (counts.get(key(issue)) ?? 0) + 1);
    return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
  };
  return {
    total: list.length,
    byState: count((issue) => issue.state),
    byKind: count((issue) => issue.kind),
    byPlatform: count((issue) => issue.platform ?? "unknown"),
    byAppVersion: count((issue) => appVersionOf(issue) ?? "unknown"),
    byOsVersion: count((issue) => osVersionOf(issue) ?? "unknown"),
  };
}

export function reporterIssues(list: BugResponse[], reporter: { userId?: string; revenueCatId?: string }) {
  const userId = reporter.userId?.toLowerCase();
  return list.filter(
    (issue) =>
      (userId !== undefined && issue.userUUID.toLowerCase() === userId) ||
      (reporter.revenueCatId !== undefined && revenueCatIdOf(issue.context) === reporter.revenueCatId),
  );
}
