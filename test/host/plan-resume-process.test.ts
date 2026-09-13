import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { RequestRecord } from "../../src/contracts.js";
import { loadOfficialPi } from "../helpers/official-pi.js";
import { openBalancedSession, seedToolHistory } from "../helpers/controlled-provider.js";

const originalHome = process.env.HOME;
const temps: string[] = [];

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folded(content: unknown): boolean {
  return JSON.stringify(content).includes("pctx folded tool result");
}

it("second official-pi process with the same session-id applies replacements on the first request", async () => {
  // Isolated agent dir: settings.extensions is only the staged pi-context package.
  // SoL-Pi and context-mode stay unloaded (same as `pi -p --session-id` with those plugins off).
  const pi = await loadOfficialPi();
  const first = await openBalancedSession(pi, {
    contextWindow: 12000,
    protectRecentBatches: 1,
    minRemovedTokens: 500,
  });
  temps.push(first.home, first.cwd, first.staging, first.sessionDir);
  seedToolHistory(first.manager, {
    batches: 6,
    resultChars: 1500,
    contextWindow: 12000,
    session: first.session,
  });
  await first.session.prompt("continue");
  const firstWire = first.captured.at(-1);
  expect(firstWire, "unexercised: process 1 never hit the provider").toBeTruthy();
  const firstFolded = (firstWire!.messages ?? []).filter((m) => m.role === "toolResult" && folded(m.content));
  expect(firstFolded.length, "process 1 must fold before we persist the plan").toBeGreaterThan(0);

  const sessionId = first.manager.getSessionId();
  const seedFile = first.manager.getSessionFile();
  expect(sessionId).toBeTruthy();
  expect(seedFile).toBeTruthy();
  const hold = mkdtempSync(join(tmpdir(), "pctx-resume-sid-"));
  temps.push(hold);
  const resumeFile = join(hold, "session.jsonl");
  cpSync(seedFile!, resumeFile);
  await first.session.dispose?.();

  const second = await openBalancedSession(pi, {
    contextWindow: 12000,
    protectRecentBatches: 1,
    minRemovedTokens: 500,
    resumeFile,
    reuse: {
      home: first.home,
      cwd: first.cwd,
      agentDir: first.agentDir,
      staging: first.staging,
    },
  });
  temps.push(second.sessionDir);
  expect(second.manager.getSessionId(), "resume must keep the same session-id").toBe(sessionId);
  await second.session.prompt("continue");
  const resumeWire = second.captured.at(0);
  expect(resumeWire, "unexercised: no first request after resume").toBeTruthy();
  const resumeFolded = (resumeWire!.messages ?? []).filter((m) => m.role === "toolResult" && folded(m.content));
  expect(resumeFolded.length, "first request of the resumed process still sent unfolded originals").toBeGreaterThan(0);
  await second.session.dispose?.();

  const status = JSON.parse(readFileSync(join(first.agentDir, "pctx-status.json"), "utf8")) as {
    lastRequests: RequestRecord[];
  };
  const firstResume = status.lastRequests.find((row) => row.sessionId === sessionId && row.purpose !== "compaction");
  expect(firstResume, "session_shutdown must record the first resumed request").toBeTruthy();
  expect(firstResume!.replacementsApplied, "persisted plan was not applied on the first resumed request").toBeGreaterThan(0);
}, 60_000);
