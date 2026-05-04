import { describe, expect, it } from "vitest";

import { ensureDatabaseInitialized } from "../src/server/db";

class MockPreparedStatement {
  constructor(readonly sql: string) {}

  bind(..._values: unknown[]) {
    return this;
  }
}

class MockD1Database {
  preparedSql: string[] = [];
  batchCalls = 0;

  prepare(sql: string) {
    this.preparedSql.push(sql);
    return new MockPreparedStatement(sql);
  }

  async batch(statements: MockPreparedStatement[]) {
    this.batchCalls += 1;
    return statements.map(() => ({ success: true }));
  }
}

describe("database schema initialization", () => {
  it("creates the schema once per database instance", async () => {
    const db = new MockD1Database() as unknown as D1Database;

    await ensureDatabaseInitialized(db);
    await ensureDatabaseInitialized(db);

    const mock = db as unknown as MockD1Database;
    expect(mock.batchCalls).toBe(1);
    expect(mock.preparedSql.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS projects"))).toBe(true);
    expect(mock.preparedSql.some((sql) => sql.includes("CREATE INDEX IF NOT EXISTS idx_comments_project_wish"))).toBe(true);
    expect(
      mock.preparedSql.some((sql) =>
        sql.includes("public_form_enabled INTEGER NOT NULL DEFAULT 0"),
      ),
    ).toBe(true);
  });
});
