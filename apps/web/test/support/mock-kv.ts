type Stored = {
  value: string;
  expiresAtMs: number | null;
};

/**
 * Minimal in-memory KV namespace for tests. Implements the subset of the
 * `KVNamespace` interface the rate-limit helper relies on (`get`, `put` with
 * `expirationTtl`, `delete`).
 */
export class MockKV {
  readonly store = new Map<string, Stored>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAtMs !== null && entry.expiresAtMs <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void> {
    const ttlSeconds = options?.expirationTtl;
    const expiresAtMs =
      typeof ttlSeconds === "number" ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAtMs });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  size(): number {
    return this.store.size;
  }
}
