import { readFileSync, rmSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { loadOfficialPi } from "../helpers/official-pi.js";
import { openBalancedSession, openPluginSession, seedToolHistory } from "../helpers/controlled-provider.js";

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

it("balanced folds only old exposed tool results and keeps the wire structure", async () => {
  const pi = await loadOfficialPi();
  const opened = await openBalancedSession(pi, { contextWindow: 12000, protectRecentBatches: 1, minRemovedTokens: 500 });
  track(opened);
  const { session, manager, captured } = opened;
  const seeded = seedToolHistory(manager, {
    batches: 6,
    resultChars: 1500,
    contextWindow: 12000,
    session,
  });
  expect(manager.getEntries().length).toBeGreaterThan(12);
  const jsonlBefore = readFileSync(manager.getSessionFile() ?? "", "utf8").split("\n").filter(Boolean);
  await session.prompt("continue");
  expect(captured.length, `captured=${captured.length}`).toBeGreaterThan(0);
  const wire = captured.at(-1)!.messages;
  expect(wire.map((m) => m.role), JSON.stringify(wire.map((m) => m.role))).toContain("toolResult");
  const results = toolResults(wire);
  expect(results).toHaveLength(6);
  expect(results.slice(0, 5).every((m) => folded(m.content))).toBe(true);
  expect(extractedText(results[5]!.content)).toContain(seeded.originals[5]!.slice(0, 40));
  expect(folded(results[5]!.content)).toBe(false);
  expect(wire.map((m) => m.role)).toEqual(captured.at(-1)!.roles);
  const stubRef = /pctx:6:[A-Za-z0-9_-]+/.exec(JSON.stringify(results[0]!.content))![0];
  const read = await session.executeTool?.("pctx_history", { action: "read", ref: stubRef });
  expect(extractedText(read)).toContain(seeded.originals[0]!.slice(0, 200));
  expect(extractedText(read)).toMatch(/"verified"\s*:\s*true/);
  await session.prompt("again");
  const first = JSON.stringify(captured.at(-2)!.messages.slice(0, 18));
  const second = JSON.stringify(captured.at(-1)!.messages.slice(0, 18));
  expect(second).toBe(first);
  await session.compact("keep native history");
  session.notices.length = 0;
  await session.prompt("/pctx status");
  const status = session.notices.join("\n");
  expect(status).toMatch(/activePlan=null/);
  expect(status).toMatch(/nativeCompactions=1/);
  const jsonlAfter = readFileSync(manager.getSessionFile() ?? "", "utf8").split("\n").filter(Boolean);
  expect(jsonlAfter.slice(0, jsonlBefore.length)).toEqual(jsonlBefore);
  await session.dispose?.();
}, 90_000);

it("does not fold a single protected batch", async () => {
  const pi = await loadOfficialPi();
  const opened = await openBalancedSession(pi, { contextWindow: 12000, protectRecentBatches: 1, minRemovedTokens: 500 });
  track(opened);
  const seeded = seedToolHistory(opened.manager, {
    batches: 1,
    resultChars: 1500,
    contextWindow: 12000,
    session: opened.session,
  });
  await opened.session.prompt("continue");
  const results = toolResults(opened.captured.at(-1)!.messages);
  expect(extractedText(results[0]?.content)).toContain(seeded.originals[0]!.slice(0, 40));
  expect(folded(results[0]?.content)).toBe(false);
  await opened.session.dispose?.();
}, 90_000);

it("keeps an unexposed last batch and isError results in the original text", async () => {
  const pi = await loadOfficialPi();
  const opened = await openBalancedSession(pi, { contextWindow: 12000, protectRecentBatches: 1, minRemovedTokens: 500 });
  track(opened);
  const first = seedToolHistory(opened.manager, {
    batches: 3,
    resultChars: 1500,
    errorAt: 1,
    contextWindow: 12000,
    session: opened.session,
  });
  const hidden = seedToolHistory(opened.manager, {
    batches: 1,
    resultChars: 1500,
    start: 4,
    skipFinalAssistant: true,
    contextWindow: 12000,
    session: opened.session,
  });
  await opened.session.prompt("continue");
  const results = toolResults(opened.captured.at(-1)!.messages);
  expect(results).toHaveLength(4);
  expect(extractedText(results[0]!.content)).toContain(first.originals[0]!.slice(0, 40));
  expect(folded(results[0]!.content)).toBe(false);
  expect(extractedText(results[3]!.content)).toContain(hidden.originals[0]!.slice(0, 40));
  expect(folded(results[3]!.content)).toBe(false);
  await opened.session.dispose?.();
}, 90_000);

it("does not expose batches after a stopReason error assistant", async () => {
  const pi = await loadOfficialPi();
  const opened = await openBalancedSession(pi, { contextWindow: 12000, protectRecentBatches: 1, minRemovedTokens: 500 });
  track(opened);
  seedToolHistory(opened.manager, {
    batches: 3,
    resultChars: 1500,
    contextWindow: 12000,
    session: opened.session,
  });
  seedToolHistory(opened.manager, {
    batches: 1,
    resultChars: 1500,
    start: 4,
    errorAssistant: true,
    skipFinalAssistant: true,
    contextWindow: 12000,
    session: opened.session,
  });
  await opened.session.prompt("continue");
  const results = toolResults(opened.captured.at(-1)!.messages);
  expect(results).toHaveLength(4);
  expect(folded(results[3]!.content)).toBe(false);
  expect(extractedText(results[3]!.content)).toContain("BATCH-4");
  await opened.session.dispose?.();
}, 90_000);

it("observe after switching profile does not emit fold stubs", async () => {
  const pi = await loadOfficialPi();
  const opened = await openPluginSession(pi, { profile: "observe", contextWindow: 12000 });
  track(opened);
  seedToolHistory(opened.manager, {
    batches: 6,
    resultChars: 1500,
    contextWindow: 12000,
    session: opened.session,
  });
  await opened.session.prompt("continue");
  const results = toolResults(opened.captured.at(-1)!.messages);
  expect(results).toHaveLength(6);
  expect(results.every((m) => !folded(m.content))).toBe(true);
  await opened.session.dispose?.();
}, 90_000);
