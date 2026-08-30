import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import { createSemanticProvider } from "../../src/semantic/port.js";
import { createSemanticProposer } from "../../src/semantic/proposer.js";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-semantic-proposer",
    sessionId: "session-proposer",
    leafId: "leaf-proposer",
    lineageEntryIds: ["root", "leaf-proposer"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

describe("evidence-cited semantic proposer", () => {
  it("rejects empty generate output as not evidence-cited", async () => {
    const bound = cursor();
    const proposer = createSemanticProposer({
      cursor: bound,
      evidence: {
        async pointers() {
          return [{ ref: "ev_known", kind: "evidence" }];
        },
      },
      provider: createSemanticProvider({
        cursor: bound,
        async generate() {
          return {};
        },
      }),
    });
    await expect(proposer.propose(
      { operationId: "op_proposer", cursor: bound },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "PCR_PROPOSER_INPUT_INVALID" });
  });
});
