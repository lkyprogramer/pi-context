import { afterEach, describe, expect, it } from "vitest";

import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";
import { createProductHarness } from "../helpers/product-harness.js";

afterEach(resetOwnerForTest);

const ALPHA = "alpha-ancestor-token-7f3c2e";
const BETA = "beta-sibling-token-9a1b0d";

function latestToolText(entries: readonly unknown[]): string {
  for (const entry of [...entries].reverse()) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as {
      type?: string;
      message?: { role?: unknown; content?: unknown; toolCallId?: unknown };
    };
    if (record.type !== "message" || !record.message) continue;
    const message = record.message;
    const role = message.role;
    const isToolResult = role === "toolResult" || role === "tool" || role === "tool-result";
    const blocks = Array.isArray(message.content) ? message.content : [];
    const texts = blocks.flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const item = block as { type?: unknown; text?: unknown; toolCallId?: unknown };
      if (typeof item.text !== "string") return [];
      if (isToolResult || item.type === "toolResult" || item.type === "tool_result") return [item.text];
      if (item.text.includes('"hits"') || item.text.includes(ALPHA) || item.text.includes(BETA)) return [item.text];
      return [];
    });
    if (isToolResult && texts.length > 0) return texts.join("\n");
    if (texts.length > 0) return texts.join("\n");
  }
  return JSON.stringify(entries);
}

async function searchSession(
  harness: Awaited<ReturnType<typeof createProductHarness>>,
  query: string,
): Promise<string> {
  const before = harness.rawEntries().length;
  await harness.runToolTurn("context_search", { query, limit: 8, timeoutMs: 250 });
  return latestToolText(harness.rawEntries().slice(before));
}

describe("ancestor evidence visibility", () => {
  it("reads tool originals after append, restart, and model switch, and isolates siblings", async () => {
    const harness = await createProductHarness();
    try {
      await harness.runToolTurn("secret_note", { token: ALPHA });
      await harness.prompt("Remember the earlier tool output and continue locally.");
      expect(await searchSession(harness, ALPHA)).toContain(ALPHA);

      await harness.restart();
      await harness.prompt("Resume after restart.");
      expect(await searchSession(harness, ALPHA)).toContain(ALPHA);

      harness.manager.appendModelChange("controlled", "context-test");
      await harness.prompt("Continue after the model fence.");
      expect(await searchSession(harness, ALPHA)).toContain(ALPHA);

      for (let index = 0; index < 100; index += 1) {
        await harness.prompt(`stable-owner ping ${index}`);
      }
      expect(await searchSession(harness, ALPHA)).toContain(ALPHA);

      const alphaLeaf = harness.manager.getLeafId();
      expect(alphaLeaf).toBeTruthy();
      const root = harness.manager.getBranch()[0];
      expect(root).toBeTruthy();
      harness.manager.branch(root!.id);
      await harness.prompt("Start a sibling branch.");
      await harness.runToolTurn("secret_note", { token: BETA });
      const siblingHits = await searchSession(harness, ALPHA);
      expect(siblingHits).not.toContain(ALPHA);
      expect(await searchSession(harness, BETA)).toContain(BETA);

      harness.manager.branch(alphaLeaf!);
      await harness.prompt("Return to the original branch.");
      expect(await searchSession(harness, ALPHA)).toContain(ALPHA);
      expect(await searchSession(harness, BETA)).not.toContain(BETA);
    } finally {
      await harness.close();
    }
  }, 120_000);

  it("allows a host-proven fork to read copied ancestors and rejects a pseudo-fork", async () => {
    const primary = await createProductHarness({ disposeRoot: false });
    let forked: Awaited<ReturnType<typeof createProductHarness>> | undefined;
    try {
      await primary.runToolTurn("secret_note", { token: ALPHA });
      await primary.prompt("Keep the original session readable.");
      expect(await searchSession(primary, ALPHA)).toContain(ALPHA);
      const leaf = primary.manager.getLeafId();
      expect(leaf).toBeTruthy();
      const branched = primary.manager.createBranchedSession(leaf!);
      expect(branched).toBeTruthy();
      const root = primary.root;
      await primary.close();

      forked = await createProductHarness({ root, sessionFile: branched, disposeRoot: true });
      await forked.prompt("Continue the host-proven fork.");
      expect(await searchSession(forked, ALPHA)).toContain(ALPHA);

      forked.manager.newSession();
      await forked.prompt("This is an unrelated session.");
      expect(await searchSession(forked, ALPHA)).not.toContain(ALPHA);
    } finally {
      await forked?.close();
      await primary.close();
    }
  }, 120_000);

  it("recovers text, utf8, image, appended, and restarted originals through production tools", async () => {
    const harness = await createProductHarness();
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    try {
      await harness.runToolTurn("log_note", { text: "ERROR ECONNREFUSED while opening students" });
      expect(await searchSession(harness, "ECONNREFUSED")).toContain("ECONNREFUSED");

      await harness.runToolTurn("utf8_note", { text: "文件=学员成绩-2026.xlsx" });
      expect(await searchSession(harness, "学员成绩")).toContain("学员成绩-2026.xlsx");

      harness.scriptToolResult("shot", {
        content: [{ type: "image", mimeType: "image/png", data: png }],
        details: { path: "shot.png" },
      });
      await harness.runToolTurn("shot", { path: "shot.png" });
      const imageText = harness.toolTexts().join("\n");
      expect(imageText.length).toBeGreaterThan(0);

      await harness.prompt("Append another user turn after the originals.");
      expect(await searchSession(harness, "ECONNREFUSED")).toContain("ECONNREFUSED");

      await harness.restart();
      await harness.prompt("Resume recovery after restart.");
      expect(await searchSession(harness, "学员成绩")).toContain("学员成绩-2026.xlsx");
      expect(await searchSession(harness, "ECONNREFUSED")).toContain("ECONNREFUSED");
    } finally {
      await harness.close();
    }
  }, 120_000);
});
