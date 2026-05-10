// Resolves an App Store URL → app metadata via the public iTunes Search API.
// The iTunes lookup endpoint is unauthenticated, returns JSON, and is CORS-
// friendly. We only call it from the worker on admin save (not on every page
// view), and cache the resolved fields on the project row.

const ITUNES_LOOKUP_URL = "https://itunes.apple.com/lookup";

export type ResolvedAppMetadata = {
  appId: string;
  appName: string;
  appIconUrl: string;
};

const ID_PATTERNS = [
  // apps.apple.com/<region?>/app/<slug>/id<digits>
  /\/id(\d{6,12})\b/,
  // raw numeric ID
  /^(\d{6,12})$/,
];

export function extractAppleAppId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  for (const pattern of ID_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

// Apple's `artworkUrl512` is a fixed-size CDN URL like
// https://is1-ssl.mzstatic.com/.../source/512x512bb.jpg . We rewrite the size
// segment to keep the asset crisp on retina favicons (256×256 = 512 physical).
export function highResIconUrl(artworkUrl: string, size = 512): string {
  return artworkUrl.replace(/\/\d+x\d+(?:bb|cc)?(?=\.\w+$)/, `/${size}x${size}bb`);
}

export async function resolveAppStoreMetadata(
  rawUrl: string,
): Promise<ResolvedAppMetadata | null> {
  const appId = extractAppleAppId(rawUrl);
  if (!appId) return null;

  let payload: {
    resultCount?: number;
    results?: Array<{
      trackName?: string;
      artworkUrl512?: string;
      artworkUrl100?: string;
      artworkUrl60?: string;
    }>;
  };

  try {
    const response = await fetch(`${ITUNES_LOOKUP_URL}?id=${appId}&country=us&entity=software`);
    if (!response.ok) {
      return null;
    }
    payload = (await response.json()) as typeof payload;
  } catch (error) {
    console.error("itunes lookup failed", { appId, error: String(error) });
    return null;
  }

  const result = payload.results?.[0];
  if (!result) return null;

  const artwork = result.artworkUrl512 ?? result.artworkUrl100 ?? result.artworkUrl60;
  if (!artwork || !result.trackName) return null;

  return {
    appId,
    appName: result.trackName,
    appIconUrl: highResIconUrl(artwork, 512),
  };
}
