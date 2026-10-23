import { fromJsonSchema, type JsonSchemaType } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import { handleOpenWishMcpRequest } from "../src/server/mcp";
import { dashboardMcpSubject, type McpAccess } from "../src/server/mcp-access";
import type { Bindings } from "../src/server/types";
import { MockD1Database } from "./support/mock-d1";
import { MockSendEmail } from "./support/mock-email";
import { MockKV } from "./support/mock-kv";
import { MockR2Bucket } from "./support/mock-r2";

type SecurityScheme = { type: "oauth2"; scopes: string[] };
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchemaType;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  securitySchemes: SecurityScheme[];
  _meta: { securitySchemes: SecurityScheme[] };
};
type RpcPayload = {
  error?: { code: number; message: string };
  result?: { tools?: Tool[]; isError?: boolean };
};

// Synthetic fixtures only. Listing tools does not read project credentials.
const API_KEY = "test-only-tool-metadata-api-key";
const PROJECT_ID = "ab000000-0000-4000-8000-000000000001";
const readTools = [
  "openwish_list_projects", "openwish_get_project", "openwish_get_project_analytics",
  "openwish_list_issues", "openwish_list_issue_notes", "openwish_get_issue_screenshot",
];
const adminTools = [
  "openwish_delete_project", "openwish_merge_features", "openwish_delete_feature", "openwish_delete_issue",
];
const writeTools = [
  "openwish_create_project", "openwish_update_project_settings", "openwish_create_feature",
  "openwish_update_feature", "openwish_reply_to_feature", "openwish_create_issue",
  "openwish_update_issue", "openwish_reply_to_issue", "openwish_add_issue_note", "openwish_send_test_email",
  "openwish_link_github", "openwish_unlink_github",
];

function environment(): Bindings {
  return {
    DB: new MockD1Database() as unknown as D1Database,
    BUGS_BUCKET: new MockR2Bucket() as unknown as R2Bucket,
    RATE_LIMIT_KV: new MockKV() as unknown as KVNamespace,
    NOTIFICATION_EMAIL: new MockSendEmail() as unknown as SendEmail,
    OPENWISH_GLOBAL_API_KEY: API_KEY,
    OPENWISH_DASHBOARD_USERNAME: "test-only-metadata-admin",
  };
}

async function requestRpc(env: Bindings, method: string, params: object = {}, access?: McpAccess) {
  const response = await handleOpenWishMcpRequest(new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Host: "localhost",
      "MCP-Protocol-Version": "2025-11-25",
      ...(!access ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }), env, undefined, access);
  expect(response.status).toBe(200);
  const body = await response.text();
  const json = response.headers.get("Content-Type")?.includes("text/event-stream")
    ? body.split("\n").find((line) => line.startsWith("data: "))?.slice(6)
    : body;
  expect(json).toBeTruthy();
  return JSON.parse(json!) as RpcPayload;
}

async function listTools(oauth = false) {
  const env = environment();
  const access: McpAccess | undefined = oauth ? {
    mode: "oauth", subject: await dashboardMcpSubject(env.OPENWISH_DASHBOARD_USERNAME!),
    projectIds: [PROJECT_ID], scopes: ["mcp:read"],
  } : undefined;
  const payload = await requestRpc(env, "tools/list", {}, access);
  expect(payload.error).toBeUndefined();
  expect(payload.result?.tools).toBeDefined();
  return payload.result!.tools!;
}

describe("MCP tool authentication metadata over HTTP", () => {
  it.each([false, true])("publishes both auth declarations and the complete permitted tool surface (OAuth=%s)", async (oauth) => {
    const tools = await listTools(oauth);
    const names = [...readTools, ...adminTools, ...writeTools].filter((name) => !oauth || name !== "openwish_create_project");
    expect(tools).toHaveLength(oauth ? 21 : 22);
    expect(tools.map((tool) => tool.name).sort()).toEqual(names.sort());
    for (const tool of tools) {
      expect(tool.title).toBeTruthy();
      expect(tool.description).toBeTruthy();
      const scopes = readTools.includes(tool.name) ? ["mcp:read"]
        : adminTools.includes(tool.name) ? ["mcp:read", "mcp:admin"]
        : ["mcp:read", "mcp:write"];
      expect(tool.securitySchemes).toEqual([{ type: "oauth2", scopes }]);
      expect(tool._meta.securitySchemes).toEqual(tool.securitySchemes);
      if (readTools.includes(tool.name)) expect(tool.annotations?.readOnlyHint).toBe(true);
      if (adminTools.includes(tool.name)) expect(tool.annotations?.destructiveHint).toBe(true);
      // Compile every advertised schema with the SDK's public JSON Schema validator.
      expect(tool.inputSchema.type).toBe("object");
      const validated = await fromJsonSchema(tool.inputSchema)["~standard"].validate({});
      expect("value" in validated || "issues" in validated).toBe(true);
    }
  });

  it("preserves input defaults, slug restrictions, UUIDs and nested diagnostic schemas", async () => {
    const tools = await listTools();
    const createProject = tools.find((tool) => tool.name === "openwish_create_project")!;
    expect(createProject.inputSchema.required).toEqual(["name", "slug"]);
    const validateProject = fromJsonSchema(createProject.inputSchema)["~standard"].validate;
    expect(await validateProject({ name: "Synthetic project", slug: "synthetic-project" })).toHaveProperty("value");
    expect(await validateProject({ name: "Synthetic project", slug: "x" })).toHaveProperty("issues");
    expect(await validateProject({ name: "Synthetic project", slug: "Bad Slug" })).toHaveProperty("issues");

    const updateIssue = tools.find((tool) => tool.name === "openwish_update_issue")!;
    const validateIssue = fromJsonSchema(updateIssue.inputSchema)["~standard"].validate;
    expect(await validateIssue({ project: "synthetic-project", issueId: PROJECT_ID, state: "fixed" })).toHaveProperty("value");
    expect(await validateIssue({ project: "synthetic-project", issueId: "invalid-uuid" })).toHaveProperty("issues");

    const createIssue = tools.find((tool) => tool.name === "openwish_create_issue")!;
    expect(await fromJsonSchema(createIssue.inputSchema)["~standard"].validate({
      project: "synthetic-project", title: "Synthetic issue", description: "Synthetic diagnostic data", context: {},
    })).toHaveProperty("value");
  });

  it("retains the SDK's tools/call validation when the list handler is overridden", async () => {
    const env = environment();
    const payload = await requestRpc(env, "tools/call", {
      name: "openwish_create_project", arguments: { name: "Synthetic project", slug: "Bad Slug" },
    });
    expect(Boolean(payload.error) || payload.result?.isError === true).toBe(true);
    expect((env.DB as unknown as MockD1Database).state.projects).toHaveLength(0);
  });
});
