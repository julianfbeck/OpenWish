type StoredObject = {
  body: ArrayBuffer;
  contentType: string;
};

function bodyByteLength(body: ArrayBuffer | Uint8Array | Blob | string): number {
  if (typeof body === "string") {
    return new TextEncoder().encode(body).byteLength;
  }
  if (body instanceof Uint8Array) {
    return body.byteLength;
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength;
  }
  // Blob is a stretch in tests; treat as zero. Tests always pass ArrayBuffer.
  return 0;
}

async function bodyToArrayBuffer(
  body: ArrayBuffer | Uint8Array | Blob | string,
): Promise<ArrayBuffer> {
  if (typeof body === "string") {
    const encoded = new TextEncoder().encode(body);
    const buffer = new ArrayBuffer(encoded.byteLength);
    new Uint8Array(buffer).set(encoded);
    return buffer;
  }
  if (body instanceof Uint8Array) {
    const buffer = new ArrayBuffer(body.byteLength);
    new Uint8Array(buffer).set(body);
    return buffer;
  }
  if (body instanceof ArrayBuffer) {
    return body;
  }
  return await body.arrayBuffer();
}

export class MockR2Bucket {
  private readonly store = new Map<string, StoredObject>();

  async put(
    key: string,
    body: ArrayBuffer | Uint8Array | Blob | string,
    options?: { httpMetadata?: { contentType?: string } },
  ) {
    const buffer = await bodyToArrayBuffer(body);
    this.store.set(key, {
      body: buffer,
      contentType: options?.httpMetadata?.contentType ?? "application/octet-stream",
    });
    return {
      key,
      size: bodyByteLength(buffer),
      httpMetadata: { contentType: options?.httpMetadata?.contentType },
    };
  }

  async get(key: string) {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    return {
      key,
      body: entry.body,
      httpMetadata: { contentType: entry.contentType },
      arrayBuffer: async () => entry.body,
    };
  }

  async head(key: string) {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    return {
      key,
      size: entry.body.byteLength,
      httpMetadata: { contentType: entry.contentType },
    };
  }

  async delete(key: string) {
    this.store.delete(key);
  }

  size() {
    return this.store.size;
  }

  has(key: string) {
    return this.store.has(key);
  }
}
