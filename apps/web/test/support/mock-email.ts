type SentMessage = {
  from: string;
  to: string;
  raw: string;
};

type EmailMessageLike = {
  from: string;
  to: string;
  raw: string;
};

export class MockSendEmail {
  readonly sent: SentMessage[] = [];

  send(message: EmailMessageLike) {
    this.sent.push({ from: message.from, to: message.to, raw: message.raw });
    return Promise.resolve();
  }
}
