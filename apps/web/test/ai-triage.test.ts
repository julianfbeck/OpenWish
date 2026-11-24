import { describe, expect, it } from "vitest";

import type { BugResponse } from "@openwish/shared";

import {
  aiTriageEnabled,
  DEFAULT_TRIAGE_MODEL,
  duplicateCandidates,
  formatTriageNote,
  interpretTriage,
  TRIAGE_NOTE_PREFIX,
} from "../src/server/ai-triage";
import type { Bindings } from "../src/server/types";
import { readSetCookie, requestApp } from "./support/app";
import { MockD1Database } from "./support/mock-d1";
import { MockSendEmail } from "./support/mock-email";
import { MockKV } from "./support/mock-kv";
import { MockR2Bucket } from "./support/mock-r2";

// Synthetic fixtures only.
const apiKey = "ow_api_triage";
const projectId = "10000000-0000-4000-8000-0000000000aa";
const reporter = "cccccccc-3333-4ccc-8ccc-cccccccccccc";
const existingId = "30000000-0000-4000-8000-0000000000aa";
const created = "2026-04-01T10:00:00.000Z";

function issue(id: string, title: string, description: string, state = "open"): BugResponse {
  return {
    id, userUUID: reporter, title, description, state: state as BugResponse["state"], screenshotKeys: [],
    reporterEmail: null, kind: "bug", context: {}, card: null, commentList: [], createdAt: created, updatedAt: created,
  };
}

class FakeAi {
  calls: Array<{ model: string; inputs: Record<string, unknown> }> = [];
  constructor(private readonly reply: (inputs: Record<string, unknown>) => unknown) {}
  async run(model: string, inputs: Record<string, unknown>) {
    this.calls.push({ model, inputs });
    return this.reply(inputs);
  }
}

function environment(ai?: FakeAi, extra: Partial<Bindings> = {}) {
  const db = new MockD1Database({
    projects: [{
      id: projectId, slug: "triage", name: "Triage", api_key: apiKey, admin_token: "ow_admin_triage",
      watermark_enabled: 0, notification_email: null, public_form_enabled: 0, app_store_url: null,
      app_id: null, app_name: null, app_icon_url: null, created_at: created, updated_at: created,
    }],
    bugs: [{
      id: existingId, project_id: projectId, user_uuid: reporter, title: "Camera stays black",
      description: "The scanner camera shows a black screen after the update", state: "open",
      screenshot_keys: "[]", reporter_email: null, issue_kind: "bug", context_json: "{}", card_json: null,
      platform: "ios", created_at: created, updated_at: created,
    }],
  });
  const env = {
    DB: db as unknown as D1Database,
    BUGS_BUCKET: new MockR2Bucket() as unknown as R2Bucket,
    RATE_LIMIT_KV: new MockKV() as unknown as KVNamespace,
    NOTIFICATION_EMAIL: new MockSendEmail() as unknown as SendEmail,
    OPENWISH_DASHBOARD_USERNAME: "admin",
    OPENWISH_DASHBOARD_PASSWORD: "secret-pass",
    OPENWISH_DASHBOARD_SESSION_SECRET: "local-test-secret",
    ...(ai ? { AI: ai as unknown as Ai } : {}),
    ...extra,
  } as Bindings;
  return { env, db };
}

function executionContext() {
  const pending: Promise<unknown>[] = [];
  const context = {
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    passThroughOnException: () => undefined,
    props: {},
  } as unknown as ExecutionContext;
  return { context, settle: () => Promise.all(pending) };
}

function submit(env: Bindings, context: ExecutionContext, path = "/api/v2/issues") {
  return requestApp(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-wishkit-api-key": apiKey, "x-wishkit-uuid": reporter, "x-wishkit-sdk-kind": "ios" },
    body: JSON.stringify({ title: "Kamera bleibt schwarz", description: "Seit dem Update ist die Kamera beim Scannen schwarz.", kind: "bug", context: {} }),
  }, env, context);
}

const germanReply = {
  response: {
    language: "de",
    isEnglish: false,
    englishTitle: "Camera stays black",
    englishDescription: "Since the update the camera is black while scanning.",
    summary: "The scanner camera shows a black screen since the latest update.",
    duplicates: [{ ref: "C1", reason: "same black camera after the update" }, { ref: "C9" }],
  },
};

describe("AI triage switch", () => {
  it("needs the Workers AI binding and can be turned off by env var", () => {
    const ai = new FakeAi(() => germanReply);
    expect(aiTriageEnabled(environment().env)).toBe(false);
    expect(aiTriageEnabled(environment(ai).env)).toBe(true);
    for (const off of ["off", "false", "0", "OFF", " disabled "]) {
      expect(aiTriageEnabled(environment(ai, { OPENWISH_AI_TRIAGE: off }).env)).toBe(false);
    }
    expect(aiTriageEnabled(environment(ai, { OPENWISH_AI_TRIAGE: "on" }).env)).toBe(true);
  });
});

describe("AI triage parsing", () => {
  const candidates = [issue(existingId, "Camera stays black", "Black screen"), issue("other", "Prices", "Wrong price")];

  it("keeps only duplicates that point at real candidates", () => {
    const result = interpretTriage(germanReply, candidates)!;
    expect(result.duplicates.map((entry) => entry.id)).toEqual([existingId]);
    expect(result.englishTitle).toBe("Camera stays black");
    expect(result.isEnglish).toBe(false);
  });

  it("accepts a JSON string reply and drops translations of English reports", () => {
    const reply = { response: `Here you go: {"language":"en","isEnglish":true,"englishTitle":"x","summary":"Crash on launch.","duplicates":[]}` };
    const result = interpretTriage(reply, candidates)!;
    expect(result).toMatchObject({ isEnglish: true, englishTitle: null, summary: "Crash on launch.", duplicates: [] });
  });

  it("rejects replies without a summary", () => {
    expect(interpretTriage({ response: "no json here" }, candidates)).toBeNull();
    expect(interpretTriage({ response: { language: "en", duplicates: [] } }, candidates)).toBeNull();
  });

  it("pre-selects lexically similar issues and skips the issue itself", () => {
    const own = { id: "new", title: "Camera black", description: "camera black after update" };
    const list = [issue("new", "Camera black", "camera black"), issue("a", "Prices wrong", "price"), issue(existingId, "Camera stays black", "black screen after update")];
    expect(duplicateCandidates(own, list).map((entry) => entry.id)).toEqual([existingId, "a"]);
  });

  it("formats a private note that names itself as AI triage", () => {
    const note = formatTriageNote(interpretTriage(germanReply, candidates)!, DEFAULT_TRIAGE_MODEL);
    expect(note.startsWith(TRIAGE_NOTE_PREFIX)).toBe(true);
    expect(note).toContain("Summary: The scanner camera shows a black screen");
    expect(note).toContain("Title (English): Camera stays black");
    expect(note).toContain(`- ${existingId.slice(0, 8)} [open] Camera stays black`);
  });
});

describe("AI triage on new issues", () => {
  it("adds a private note after the SDK response without changing it", async () => {
    const ai = new FakeAi(() => germanReply);
    const { env, db } = environment(ai);
    const { context, settle } = executionContext();

    const response = await submit(env, context);
    expect(response.status).toBe(201);
    expect(Object.keys(await response.json()).sort()).toEqual(["createdAt", "id", "state"]);
    await settle();

    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]!.model).toBe(DEFAULT_TRIAGE_MODEL);
    const prompt = JSON.stringify(ai.calls[0]!.inputs.messages);
    expect(prompt).toContain("Kamera bleibt schwarz");
    expect(prompt).toContain("C1 [open] Camera stays black");
    expect(db.state.issueNotes).toHaveLength(1);
    expect(db.state.issueNotes[0]!.body).toContain("Likely duplicates:");
    // Never a reply the reporter can see.
    expect(db.state.bugComments).toHaveLength(0);

    const list = await requestApp("/api/v2/issues", { headers: { "x-wishkit-api-key": apiKey, "x-wishkit-uuid": reporter } }, env);
    const payload = (await list.json()) as { list: Array<Record<string, unknown>> };
    expect(JSON.stringify(payload)).not.toContain(TRIAGE_NOTE_PREFIX);

    // The dashboard reads it through the session-authenticated admin route.
    const newId = db.state.issueNotes[0]!.issue_id;
    expect((await requestApp(`/api/admin/projects/triage/bugs/${newId}/notes`, undefined, env)).status).toBe(401);
    const login = await requestApp("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "secret-pass" }),
    }, env);
    const notes = await requestApp(`/api/admin/projects/triage/bugs/${newId}/notes`, { headers: { Cookie: readSetCookie(login) ?? "" } }, env);
    expect(notes.status).toBe(200);
    const notePayload = (await notes.json()) as { list: Array<{ body: string }> };
    expect(notePayload.list[0]!.body.startsWith(TRIAGE_NOTE_PREFIX)).toBe(true);
  });

  it("also runs for the legacy bug route and uses the configured model", async () => {
    const ai = new FakeAi(() => germanReply);
    const { env, db } = environment(ai, { OPENWISH_AI_TRIAGE_MODEL: "@cf/test/model" });
    const { context, settle } = executionContext();
    expect((await submit(env, context, "/api/bug/create")).status).toBe(200);
    await settle();
    expect(ai.calls[0]!.model).toBe("@cf/test/model");
    expect(db.state.issueNotes).toHaveLength(1);
  });

  it("does nothing when switched off", async () => {
    const ai = new FakeAi(() => germanReply);
    const { env, db } = environment(ai, { OPENWISH_AI_TRIAGE: "off" });
    const { context, settle } = executionContext();
    expect((await submit(env, context)).status).toBe(201);
    await settle();
    expect(ai.calls).toHaveLength(0);
    expect(db.state.issueNotes).toHaveLength(0);
  });

  it("keeps the submission when the model fails or answers nonsense", async () => {
    for (const reply of [() => { throw new Error("model unavailable"); }, () => ({ response: "???" })]) {
      const { env, db } = environment(new FakeAi(reply));
      const { context, settle } = executionContext();
      expect((await submit(env, context)).status).toBe(201);
      await settle();
      expect(db.state.bugs).toHaveLength(2);
      expect(db.state.issueNotes).toHaveLength(0);
    }
  });
});
