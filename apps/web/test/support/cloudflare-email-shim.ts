// Shim used in vitest. The real `cloudflare:email` is only available inside
// the Workers runtime, so during tests we replace it with a tiny class that
// MockSendEmail.send understands.

export class EmailMessage {
  readonly from: string;
  readonly to: string;
  readonly raw: string;

  constructor(from: string, to: string, raw: string) {
    this.from = from;
    this.to = to;
    this.raw = raw;
  }
}
