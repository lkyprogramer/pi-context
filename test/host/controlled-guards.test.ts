import { rmSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { loadReviewFixture } from "../../eval/local/scenarios.mjs";
import { loadOfficialPi } from "../helpers/official-pi.js";
import {
  G02_MARKERS,
  openBalancedSession,
  openPluginSession,
  seedMediaErrorHistory,
  seedToolHistory,
  stripTimestamps,
} from "../helpers/controlled-provider.js";

const originalHome = process.env.HOME;
const temps: string[] = [];

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function track(opened: { home: string; cwd: string; staging: string; sessionDir: string }): void {
  temps.push(opened.home, opened.cwd, opened.staging, opened.sessionDir);
}

function toolResults(messages: Array<{ role?: string; content?: unknown }>) {
  return messages.filter((m) => m.role === "toolResult");
}

function folded(content: unknown): boolean {
  return JSON.stringify(content).includes("pctx folded tool result");
}

function extractedText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractedText).join("");
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(extractedText).join("");
  }
  return "";
}

it("G01 observe keeps message bytes; balanced does not fold without pressure", async () => {
  const fx = loadReviewFixture("G01");
  expect(fx.requiresFold).toBe(false);
  expect(fx.finalPrompt.includes(fx.witness)).toBe(false);
  const pi = await loadOfficialPi();
  const plugin = await openPluginSession(pi, { profile: "observe", contextWindow: 12000, scriptUsagePercent: 0.25 });
  const baseline = await openPluginSession(pi, {
    profile: "observe",
    contextWindow: 12000,
    loadPlugin: false,
    scriptUsagePercent: 0.25,
  });
  track(plugin);
  track(baseline);
  seedToolHistory(plugin.manager, {
    batches: 2,
    resultChars: 200,
    contextWindow: 12000,
    usagePercent: 25,
    session: plugin.session,
  });
  seedToolHistory(baseline.manager, {
    batches: 2,
    resultChars: 200,
    contextWindow: 12000,
    usagePercent: 25,
    session: baseline.session,
  });
  await plugin.session.prompt(fx.finalPrompt);
  await baseline.session.prompt(fx.finalPrompt);
  expect(plugin.captured.length).toBe(1);
  expect(baseline.captured.length).toBe(1);
  expect(JSON.stringify(stripTimestamps(plugin.captured[0]!.messages))).toBe(
    JSON.stringify(stripTimestamps(baseline.captured[0]!.messages)),
  );
  await plugin.session.dispose?.();
  await baseline.session.dispose?.();

  const balanced = await openBalancedSession(pi, { contextWindow: 12000, scriptUsagePercent: 0.25 });
  track(balanced);
  seedToolHistory(balanced.manager, {
    batches: 2,
    resultChars: 200,
    contextWindow: 12000,
    usagePercent: 25,
    session: balanced.session,
  });
  await balanced.session.prompt(fx.finalPrompt);
  const results = toolResults(balanced.captured.at(-1)!.messages);
  expect(results.length).toBeGreaterThan(0);
  expect(results.every((m) => !folded(m.content))).toBe(true);
  await balanced.session.dispose?.();
}, 90_000);

it("G02 keeps image, errors, incomplete and duplicate-id batches off the fold plan", async () => {
  const fx = loadReviewFixture("G02");
  expect(fx.requiresFold).toBe(false);
  expect(fx.finalPrompt.includes(fx.witness)).toBe(false);
  const pi = await loadOfficialPi();
  const opened = await openBalancedSession(pi, { contextWindow: 12000, protectRecentBatches: 1, minRemovedTokens: 500 });
  track(opened);
  const seeded = seedMediaErrorHistory(opened.manager, { contextWindow: 12000, session: opened.session });
  await opened.session.prompt(fx.finalPrompt);
  await opened.session.prompt("fold-now");
  const wire = opened.captured.at(-1);
  expect(wire, "unexercised: no provider wire").toBeTruthy();
  const results = toolResults(wire!.messages);
  const foldedResults = results.filter((m) => folded(m.content));
  expect(foldedResults.length, "unexercised: fold did not apply to old text").toBeGreaterThan(0);

  const image = results.find((m) => extractedText(m.content).includes(G02_MARKERS.imageText));
  expect(image, "image toolResult missing from wire").toBeTruthy();
  expect(folded(image!.content)).toBe(false);
  expect(JSON.stringify(image!.content)).toContain(seeded.png);
  expect(JSON.stringify(image!.content)).toContain("image/png");

  const error = results.find((m) => extractedText(m.content).includes(G02_MARKERS.errorText));
  expect(error, "error toolResult missing from wire").toBeTruthy();
  expect(folded(error!.content)).toBe(false);

  const incomplete = results.find((m) => extractedText(m.content).includes(G02_MARKERS.incompleteText));
  expect(incomplete, "incomplete toolResult missing from wire").toBeTruthy();
  expect(folded(incomplete!.content)).toBe(false);

  const duplicate = results.find((m) => extractedText(m.content).includes(G02_MARKERS.duplicateText));
  expect(duplicate, "duplicate-id toolResult missing from wire").toBeTruthy();
  expect(folded(duplicate!.content)).toBe(false);
  await opened.session.dispose?.();
}, 90_000);
