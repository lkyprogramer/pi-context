import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("default extension production root", () => {
  it("does not keep an in-file context registry or compaction factory", () => {
    const source = readFileSync("apps/pi-context-runtime/src/extension.ts", "utf8");
    expect(source).not.toMatch(/function createExtensionContextRegistry/);
    expect(source).not.toMatch(/function createProductCompactionService/);
    expect(source).toMatch(/registerProductionUserTurnRuntime/);
  });

  it("does not construct materializer or checkpoint renderer inside pi-adapter", () => {
    const source = readFileSync("packages/pi-adapter/src/context-hook.ts", "utf8");
    expect(source).not.toMatch(/createMaterializer/);
    expect(source).not.toMatch(/createCheckpointRenderer/);
  });
});
