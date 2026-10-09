const defaultLoginReturnPath = "/dashboard/projects";

export function safeLoginReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) {
    return defaultLoginReturnPath;
  }

  const origin = "https://openwish.invalid";
  try {
    const target = new URL(value, origin);
    // Dot-segment normalization can turn a local path into a leading // path.
    if (target.origin !== origin || target.pathname.startsWith("//")) {
      return defaultLoginReturnPath;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return defaultLoginReturnPath;
  }
}

export function assignLocation(path: string) {
  window.location.assign(path);
}
