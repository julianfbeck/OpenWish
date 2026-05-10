import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractAppleAppId,
  highResIconUrl,
  resolveAppStoreMetadata,
} from "../src/server/app-store";

describe("App Store URL parsing", () => {
  it("extracts the track id from a standard apps.apple.com URL", () => {
    expect(
      extractAppleAppId("https://apps.apple.com/de/app/scrytics/id6747878828"),
    ).toBe("6747878828");
  });

  it("extracts the track id when there's no region segment", () => {
    expect(
      extractAppleAppId("https://apps.apple.com/app/scrytics/id1234567890"),
    ).toBe("1234567890");
  });

  it("extracts a raw numeric id", () => {
    expect(extractAppleAppId("6747878828")).toBe("6747878828");
  });

  it("returns null for unrelated URLs", () => {
    expect(extractAppleAppId("https://example.com/app")).toBeNull();
    expect(extractAppleAppId("")).toBeNull();
  });
});

describe("highResIconUrl", () => {
  it("rewrites the size segment in the iTunes artwork CDN URL", () => {
    const small =
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/abc/source/100x100bb.jpg";
    expect(highResIconUrl(small, 512)).toBe(
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/abc/source/512x512bb.jpg",
    );
  });

  it("leaves URLs without a recognizable size segment alone", () => {
    expect(highResIconUrl("https://example.com/icon.png", 512)).toBe(
      "https://example.com/icon.png",
    );
  });
});

describe("resolveAppStoreMetadata", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns name + icon when iTunes lookup succeeds", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({
          resultCount: 1,
          results: [
            {
              trackName: "Scrytics",
              artworkUrl512:
                "https://is1-ssl.mzstatic.com/image/thumb/v4/source/512x512bb.jpg",
              artworkUrl100:
                "https://is1-ssl.mzstatic.com/image/thumb/v4/source/100x100bb.jpg",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await resolveAppStoreMetadata(
      "https://apps.apple.com/de/app/scrytics/id6747878828",
    );

    expect(result).toEqual({
      appId: "6747878828",
      appName: "Scrytics",
      appIconUrl: "https://is1-ssl.mzstatic.com/image/thumb/v4/source/512x512bb.jpg",
    });
  });

  it("returns null when the lookup yields no results", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 }),
    );

    const result = await resolveAppStoreMetadata(
      "https://apps.apple.com/de/app/missing/id9999999999",
    );

    expect(result).toBeNull();
  });

  it("returns null for URLs without a track id", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await resolveAppStoreMetadata("https://example.com/no-id-here");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
