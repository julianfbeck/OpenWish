import type { GitHubLinkType } from "@openwish/shared";

export type ParsedGitHubLink = {
  url: string;
  type: GitHubLinkType;
  repository: string;
  number: number;
};

const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const repoPattern = /^[A-Za-z0-9._-]{1,100}$/;

// Accepts https://github.com/<owner>/<repo>/issues/<n> and /pull/<n>, including
// deeper views (/files, /commits), query strings and fragments, and returns the
// canonical URL so the same issue or pull request is only linked once.
export function parseGitHubLink(input: string): ParsedGitHubLink | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
  if (url.username || url.password || (url.port && url.port !== "443")) return null;

  const [owner, repo, section, rawNumber] = url.pathname.split("/").filter(Boolean);
  if (!owner || !repo || !rawNumber || !ownerPattern.test(owner) || !repoPattern.test(repo) || repo === "." || repo === "..") {
    return null;
  }
  const type: GitHubLinkType | null = section === "issues" ? "issue" : section === "pull" ? "pull" : null;
  if (!type || !/^[1-9][0-9]{0,9}$/.test(rawNumber)) return null;

  const number = Number(rawNumber);
  return {
    url: `https://github.com/${owner}/${repo}/${section}/${number}`,
    type,
    repository: `${owner}/${repo}`,
    number,
  };
}
