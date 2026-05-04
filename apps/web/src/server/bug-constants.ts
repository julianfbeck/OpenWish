export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
export const MAX_SCREENSHOTS_PER_BUG = 4;

export const ALLOWED_SCREENSHOT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
] as const;

export type AllowedScreenshotType = (typeof ALLOWED_SCREENSHOT_TYPES)[number];

const EXTENSION_BY_TYPE: Record<AllowedScreenshotType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/webp": "webp",
};

export function isAllowedScreenshotType(value: string): value is AllowedScreenshotType {
  return (ALLOWED_SCREENSHOT_TYPES as readonly string[]).includes(value);
}

export function extensionForContentType(contentType: AllowedScreenshotType): string {
  return EXTENSION_BY_TYPE[contentType];
}

export function screenshotKeyFor(projectId: string, contentType: AllowedScreenshotType): string {
  const extension = extensionForContentType(contentType);
  return `bugs/${projectId}/${crypto.randomUUID()}.${extension}`;
}

export function isScreenshotKeyForProject(key: string, projectId: string): boolean {
  return key.startsWith(`bugs/${projectId}/`);
}
