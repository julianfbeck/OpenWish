import { describe, expect, it } from "vitest";

import { safeLoginReturnPath } from "../src/lib/navigation";

describe("safe login return paths", () => {
  it("preserves the OAuth authorization query after login", () => {
    const path = "/oauth/authorize?client_id=chatgpt&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector%2Foauth%2Ftest&scope=mcp%3Aread&state=abc#consent";
    expect(safeLoginReturnPath(path)).toBe(path);
    expect(safeLoginReturnPath("/dashboard/eyevo/bugs")).toBe("/dashboard/eyevo/bugs");
  });

  it.each([
    null,
    undefined,
    "",
    "dashboard/projects",
    "https://example.test/oauth",
    "http://example.test/oauth",
    "javascript:alert(1)",
    "//example.test/oauth",
    "///example.test/oauth",
    "/\\example.test/oauth",
    "\\\\example.test/oauth",
    "\n//example.test/oauth",
    "/\texample.test/oauth",
    "/oauth\u0000/authorize",
    "/.//example.test/oauth",
    "/%2e//example.test/oauth",
    "/%2e%2e//example.test/oauth",
  ])("rejects an unsafe or absent return path: %s", (path) => {
    expect(safeLoginReturnPath(path)).toBe("/dashboard/projects");
  });
});
