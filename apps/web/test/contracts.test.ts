import { describe, expect, it } from "vitest";

import { apiErrorReasonValues, wishStateValues } from "@openwish/shared";

describe("shared contracts", () => {
  it("keeps all Swift-compatible wish states", () => {
    expect(wishStateValues).toEqual([
      "approved",
      "implemented",
      "pending",
      "inReview",
      "planned",
      "inProgress",
      "completed",
      "rejected",
    ]);
  });

  it("keeps all Swift-compatible API error reasons", () => {
    expect(apiErrorReasonValues).toContain("missingApiHeaderKey");
    expect(apiErrorReasonValues).toContain("missingUUIDHeaderKey");
  });
});
