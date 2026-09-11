import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { buildReviewSeed, warmupFiles } from "../../eval/local/review-seed.mjs";
import { loadReviewFixture } from "../../eval/local/scenarios.mjs";
import { loadOfficialPi } from "../helpers/official-pi.js";
import {
  openBalancedSession,
  syncAgentFromManager,
  type ControlledScript,
  type SessionManagerLike,
} from "../helpers/controlled-provider.js";

const originalHome = process.env.HOME;
const temps: string[] = [];
const repoRoot = join(import.meta.dirname, "../..");

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const folded = (c: unknown) => JSON.stringify(c).includes("pctx folded tool result");
const toolResults = (ms: Array<{ role: string; content: unknown }>) => ms.filter((m) => m.role === "toolResult");

function warmupScript(
  files: Array<{ name: string; text: string }>,
  usagePercents: number[],
): ControlledScript {
  return usagePercents.map((usagePercent, i) => (
    i < files.length
      ? { text: `read ${files[i]!.name}`, usagePercent }
      : { text: "ok", usagePercent }
  ));
}

function appendDump(
  manager: SessionManagerLike,
  session: { messages: unknown[] },
  file: { name: string; text: string },
): void {
  const now = Date.now();
  const callId = `warmup-${file.name}`;
  // Complete tool batch so protectRecentBatches can keep the dump. Omit usage
  // on the toolCall assistant so lastSuccessfulAssistantUsage stays on the
  // previous prompt (Pi estimates last-assistant + trailing).
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "toolCall", id: callId, name: "read", arguments: { path: `notes/${file.name}` } }],
    api: "openai-completions",
    provider: "controlled",
    model: "wire",
    stopReason: "toolUse",
    timestamp: now,
  });
  manager.appendMessage({
    role: "toolResult",
    toolCallId: callId,
    toolName: "read",
    content: [{ type: "text", text: file.text }],
    isError: false,
    timestamp: now + 1,
  });
  syncAgentFromManager(session, manager);
}

it("W-Q01 does not fold on the first request and folds only after the warm-up dumps push usage past 60%", async () => {
  const fx = loadReviewFixture("W-Q01");
  const seed = buildReviewSeed(fx);
  expect(seed.targetTokens).toBe(Math.ceil(65_536 * 0.45));
  const resumeFile = join(mkdtempSync(join(tmpdir(), "wq01-")), "seed.jsonl");
  writeFileSync(resumeFile, seed.jsonl);
  const files = warmupFiles(fx, repoRoot);
  const pi = await loadOfficialPi();
  const s = await openBalancedSession(pi, {
    contextWindow: 65_536,
    protectRecentBatches: 4,
    minRemovedTokens: 4096,
    resumeFile,
    // Card wrote [0.47, 0.57, 0.67]; Pi usage is last-assistant + trailing, so
    // 0.47 + dump-a (~12k est. tokens) already crosses 60% on the second prompt.
    script: warmupScript(files, [0.40, 0.50, 0.67]),
  });
  temps.push(s.home, s.cwd, s.staging, s.sessionDir);
  mkdirSync(join(s.cwd, "notes"), { recursive: true });
  writeFileSync(join(s.cwd, "notes", files[0]!.name), files[0]!.text);
  writeFileSync(join(s.cwd, "notes", files[1]!.name), files[1]!.text);

  await s.session.prompt("cat notes/dump-a.txt");
  expect(toolResults(s.captured[0]!.messages).some((m) => folded(m.content)), "first request must not fold at 45%").toBe(false);
  appendDump(s.manager, s.session, files[0]!);

  await s.session.prompt("cat notes/dump-b.txt");
  expect(toolResults(s.captured[1]!.messages).some((m) => folded(m.content)), "still below 60% before second dump lands").toBe(false);
  appendDump(s.manager, s.session, files[1]!);

  await s.session.prompt(fx.finalPrompt);
  const third = toolResults(s.captured[2]!.messages);
  expect(third.some((m) => folded(m.content)), "fold must happen mid-session once usage passed 60%").toBe(true);
  const dumps = third.filter((m) => {
    const text = JSON.stringify(m.content);
    return text.includes("[dump-a ") || text.includes("[dump-b ");
  });
  expect(dumps.length).toBeGreaterThan(0);
  expect(dumps.every((m) => !folded(m.content)), "the two warm-up dumps are inside the protected recent batches").toBe(true);
  await s.session.dispose?.();
}, 120_000);
