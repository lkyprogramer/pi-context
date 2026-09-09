import { rmSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { loadReviewFixture } from "../../eval/local/scenarios.mjs";
import { loadOfficialPi } from "../helpers/official-pi.js";
import { openBalancedSession, seedToolHistory } from "../helpers/controlled-provider.js";

const originalHome = process.env.HOME;
const temps: string[] = [];

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function extractedText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractedText).join("");
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(extractedText).join("");
  }
  return "";
}

function folded(content: unknown): boolean {
  return JSON.stringify(content).includes("pctx folded tool result");
}

it("Q01 witness is exposed, folded after four later batches, then recovered by history read", async () => {
  const fx = loadReviewFixture("Q01");
  const pi = await loadOfficialPi();
  const opened = await openBalancedSession(pi, { contextWindow: 12000, protectRecentBatches: 1, minRemovedTokens: 500 });
  temps.push(opened.home, opened.cwd, opened.staging, opened.sessionDir);
  const { session, manager, captured } = opened;
  seedToolHistory(manager, {
    batches: 6,
    resultChars: 1500,
    contextWindow: 12000,
    prefixText: fx.seedText,
    session,
  });
  await session.prompt("continue");
  await session.prompt("fold-now");
  const wire = captured.at(-1);
  expect(wire, "unexercised: no provider wire after fold-now").toBeTruthy();
  const results = (wire!.messages ?? []).filter((m) => m.role === "toolResult");
  const foldedResults = results.filter((m) => folded(m.content));
  expect(foldedResults.length, "unexercised: fold did not apply on the controlled 60% path").toBeGreaterThan(0);
  let recovered = "";
  for (const m of foldedResults) {
    const stub = /pctx:6:[A-Za-z0-9_-]+/.exec(JSON.stringify(m.content));
    if (!stub) continue;
    recovered = extractedText(await session.executeTool?.("pctx_history", { action: "read", ref: stub[0] }));
    if (recovered.includes(fx.witness)) break;
  }
  expect(recovered, `no FieldRef recovered witness; folded=${foldedResults.length}`).toContain(fx.witness);
  expect(fx.finalPrompt.includes(fx.witness)).toBe(false);
});
