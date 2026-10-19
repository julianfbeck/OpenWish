// Remembers the dashboard project the admin last worked in, so the projects
// page, the project switcher and the post-login landing page reopen it instead
// of falling back to the first project. Stored per browser in localStorage;
// every access is guarded because storage can be unavailable (private mode,
// blocked site data, SSR).

const storageKey = "openwish:last-project-slug";
const slugPattern = /^[a-z0-9-]{2,60}$/;

export function readLastProjectSlug(): string | null {
  try {
    const value = window.localStorage.getItem(storageKey);
    return value && slugPattern.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberLastProjectSlug(slug: string) {
  if (!slugPattern.test(slug)) {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, slug);
  } catch {
    // Storage unavailable — remembering is a convenience only.
  }
}

export function forgetLastProjectSlug(slug?: string) {
  try {
    if (slug === undefined || window.localStorage.getItem(storageKey) === slug) {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // Storage unavailable — nothing to forget.
  }
}

export function lastProjectHomePath(): string {
  const slug = readLastProjectSlug();
  return slug ? `/dashboard/${slug}` : "/dashboard/projects";
}
