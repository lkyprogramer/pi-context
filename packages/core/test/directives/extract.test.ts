import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { blobId } from "@pcr/contracts";
import { createRuntimeCursor } from "../../src/identity/index.js";
import { createClauseSegmenter } from "../../src/directives/segment.js";
import { extractDirectiveCandidates } from "../../src/directives/extract.js";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-core-extract",
    sessionId: "session-extract",
    leafId: "leaf-extract",
    lineageEntryIds: ["root", "leaf-extract"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

describe("directive extraction", () => {
  it("keeps the full clause as the quote and does not rewrite polarity to must-not", () => {
    const bound = cursor();
    const text = "改为使用 SHA-256。Keep going.";
    const bytes = Buffer.from(text, "utf8");
    const clauses = createClauseSegmenter({ cursor: bound }).segment({ text, cursor: bound });
    const [correction] = extractDirectiveCandidates({
      userTurnId: "user_turn_extract",
      cursor: bound,
      rawTextHash: createHash("sha256").update(bytes).digest("hex"),
      rawBlobId: blobId(`blob_${"b".repeat(64)}`),
      utf8Bytes: bytes.byteLength,
      hostMessageId: "host-extract",
      sourceClass: "authenticated-user",
      capturedAt: 17,
    }, clauses);
    expect(correction?.kind).toBe("correction");
    expect(correction?.polarity).toBe("must");
    expect(correction?.exactQuote).toContain("改为使用 SHA-256");
    expect(correction?.exactQuote).not.toBe("改为");
  });
});
