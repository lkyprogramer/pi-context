import { copyFileSync, existsSync } from "node:fs";

import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";
import { assertSessionToolPairs } from "../../packages/benchmark/src/small-live.js";
import { createProductHarness } from "./product-harness.js";

export interface SeedSourceEntry {
  id: string;
  role: "user" | "tool" | "assistant";
  text: string;
}

export async function seedScenarioSessionViaProduct(input: {
  sessionFile: string;
  cwd: string;
  scenario: { id: string; sourceEntries: readonly SeedSourceEntry[] };
}): Promise<void> {
  if (!existsSync(input.sessionFile)) {
    throw new Error("PCR_SEED_SESSION_FILE_MISSING");
  }
  const harness = await createProductHarness({
    root: input.cwd,
    sessionFile: input.sessionFile,
    disposeRoot: false,
  });
  try {
    for (const entry of input.scenario.sourceEntries) {
      if (entry.role === "tool") {
        const name = `seed_${entry.id.replaceAll(/[^a-zA-Z0-9_]/gu, "_")}`;
        harness.scriptToolResult(name, {
          content: [{ type: "text", text: entry.text }],
        });
        await harness.runToolTurn(name, { sourceEntryId: entry.id });
        continue;
      }
      if (entry.role === "assistant") {
        harness.setAssistantText(entry.text);
        await harness.prompt("Record the prior assistant observation.");
        continue;
      }
      await harness.prompt(entry.text);
    }
    const written = harness.manager.getSessionFile();
    if (typeof written === "string" && written.length > 0 && written !== input.sessionFile) {
      copyFileSync(written, input.sessionFile);
    }
    assertSessionToolPairs(input.sessionFile);
  } finally {
    await harness.close();
    resetOwnerForTest();
  }
}
