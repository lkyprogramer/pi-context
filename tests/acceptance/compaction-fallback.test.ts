import { describe, expect, it } from "vitest";

import {
  registerCompactionHooks,
  type CompactionEvent,
  type CompactionExtensionAPI,
} from "../../packages/pi-adapter/src/compaction-hook.js";

describe("compaction native fallback", () => {
  it("returns undefined so Pi Native can continue after a soft rejection", async () => {
    let handler: ((event: CompactionEvent, ctx: { abort(): void }) => Promise<unknown>) | undefined;
    const pi: CompactionExtensionAPI = {
      on(hook, next) {
        if (hook === "session_before_compact") handler = next as typeof handler;
      },
    };
    registerCompactionHooks(pi, {
      async prepareCompaction() {
        return { kind: "native-fallback" };
      },
      async stageCompaction() {},
      async ackHostCompaction() {},
      async failStagedCompaction() {},
    });
    const result = await handler!(
      { preparation: { tokensBefore: 4096, firstKeptEntryId: "entry-keep" }, reason: "overflow" },
      { abort() {} },
    );
    expect(result).toBeUndefined();
  });
});
