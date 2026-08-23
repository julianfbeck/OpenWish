import { describe, expect, it } from "vitest";

import { handleOpenWishMcpRequest } from "../src/server/mcp";
import type { Bindings } from "../src/server/types";
import { MockD1Database } from "./support/mock-d1";
import { MockR2Bucket } from "./support/mock-r2";
import { MockSendEmail } from "./support/mock-email";
import { MockKV } from "./support/mock-kv";
import { readSetCookie, requestApp } from "./support/app";

function env(): Bindings {
  return {
    DB: new MockD1Database() as unknown as D1Database,
    BUGS_BUCKET: new MockR2Bucket() as unknown as R2Bucket,
    RATE_LIMIT_KV: new MockKV() as unknown as KVNamespace,
    NOTIFICATION_EMAIL: new MockSendEmail() as unknown as SendEmail,
    OPENWISH_GLOBAL_API_KEY: "mcp-test-token",
  };
}

function mcpRequest(body: object, token?: string) {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Host: "localhost",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function readMcpResponse<T>(response: Response): Promise<T> {
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const text = await response.text();
    const data = text
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice(6);
    if (!data) throw new Error("MCP SSE response did not contain data.");
    return JSON.parse(data) as T;
  }
  return (await response.json()) as T;
}

describe("remote MCP", () => {
  it("shows MCP credentials only to an authenticated dashboard session", async () => {
    const testEnv = {
      ...env(),
      OPENWISH_DASHBOARD_USERNAME: "admin",
      OPENWISH_DASHBOARD_PASSWORD: "password",
      OPENWISH_DASHBOARD_SESSION_SECRET: "test-session-secret",
    };
    const anonymous = await requestApp("/api/auth/mcp", undefined, testEnv);
    expect(anonymous.status).toBe(401);

    const login = await requestApp(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "password" }),
      },
      testEnv,
    );
    const cookie = readSetCookie(login);
    const response = await requestApp(
      "https://wishkit.example.test/api/auth/mcp",
      { headers: { Cookie: cookie ?? "" } },
      testEnv,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const payload = (await response.json()) as { endpoint: string; token: string };
    expect(payload.endpoint).toBe("https://wishkit.example.test/mcp");
    expect(payload.token).toBe("mcp-test-token");
  });

  it("rejects missing and wrong bearer tokens", async () => {
    const missing = await handleOpenWishMcpRequest(
      mcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      env(),
    );
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toContain("Bearer");

    const wrong = await handleOpenWishMcpRequest(
      mcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, "wrong"),
      env(),
    );
    expect(wrong.status).toBe(401);
  });

  it("initializes over Streamable HTTP and exposes the complete tool surface", async () => {
    const initialize = await handleOpenWishMcpRequest(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "test", version: "1.0.0" },
          },
        },
        "mcp-test-token",
      ),
      env(),
    );
    expect(initialize.status).toBe(200);
    const initialized = await readMcpResponse<{ result?: { serverInfo?: { name?: string } } }>(initialize);
    expect(initialized.result?.serverInfo?.name).toBe("openwish");

    const listed = await handleOpenWishMcpRequest(
      mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, "mcp-test-token"),
      env(),
    );
    expect(listed.status).toBe(200);
    const payload = await readMcpResponse<{ result?: { tools?: Array<{ name: string }> } }>(listed);
    const names = payload.result?.tools?.map((tool) => tool.name) ?? [];
    expect(names).toContain("openwish_list_projects");
    expect(names).toContain("openwish_update_feature");
    expect(names).toContain("openwish_reply_to_issue");
    expect(names).toContain("openwish_get_issue_screenshot");
    expect(names).toContain("openwish_delete_project");
    expect(names.length).toBeGreaterThanOrEqual(18);
  });
});
