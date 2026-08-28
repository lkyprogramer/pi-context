export interface KeyProvider {
  ready(): Promise<void>;
  workspaceKey(): Promise<Buffer>;
}

export class TestKeyProvider implements KeyProvider {
  constructor(private readonly key: Buffer | null) {}

  async ready(): Promise<void> {
    if (!this.key || this.key.byteLength !== 32) {
      throw Object.assign(new Error("PCR_KEY_UNAVAILABLE"), { code: "PCR_KEY_UNAVAILABLE" });
    }
  }

  async workspaceKey(): Promise<Buffer> {
    await this.ready();
    return this.key as Buffer;
  }
}
