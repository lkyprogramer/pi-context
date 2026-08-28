export interface PiContractHarness {
  startSession(reason: "startup" | "new" | "resume" | "fork"): Promise<void>;
  emitContext(messages: unknown[]): Promise<unknown[]>;
  executeTool(name: string, input: unknown, result: unknown): Promise<unknown>;
  compact(reason: "manual" | "threshold" | "overflow"): Promise<void>;
  navigateTree(targetId: string): Promise<void>;
  readSessionEntries(): Promise<unknown[]>;
  shutdown(): Promise<void>;
}
