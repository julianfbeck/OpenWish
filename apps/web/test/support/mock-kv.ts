type Stored = {
  value: string;
  expiresAtMs: number | null;
  metadata?: unknown;
};

/**
 * Minimal in-memory KV namespace for tests. Implements the subset of the
 * `KVNamespace` interface the rate-limit helper relies on (`get`, `put` with
 * `expirationTtl`, `delete`).
 */
export class MockKV {
  readonly store = new Map<string, Stored>();

  async get<T = string>(key: string, options?: string | { type?: string }): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAtMs !== null && entry.expiresAtMs <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    const type = typeof options === "string" ? options : options?.type;
    return (type === "json" ? JSON.parse(entry.value) : entry.value) as T;
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; expiration?: number; metadata?: unknown },
  ): Promise<void> {
    const ttlSeconds = options?.expirationTtl;
    const expiresAtMs = options?.expiration === undefined
      ? (typeof ttlSeconds === "number" ? Date.now() + ttlSeconds * 1000 : null)
      : options.expiration * 1000;
    this.store.set(key, { value, expiresAtMs, metadata: options?.metadata });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
    const names = [...this.store.keys()].sort();
    const entries: Array<{ name: string; metadata?: unknown; expiration?: number }> = [];
    for (const name of names) {
      if (!name.startsWith(options?.prefix ?? "") || name <= (options?.cursor ?? "")) continue;
      if (await this.get(name) === null) continue;
      const stored = this.store.get(name)!;
      entries.push({ name, metadata: stored.metadata,
        ...(stored.expiresAtMs === null ? {} : { expiration: stored.expiresAtMs / 1000 }) });
    }
    const keys = entries.slice(0, options?.limit ?? 1000);
    const complete = keys.length === entries.length;
    return { keys, list_complete: complete, cursor: complete ? "" : keys.at(-1)!.name };
  }

  size(): number {
    return this.store.size;
  }
}
