import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { register } from "../../apps/pi-context-runtime/src/extension.js";
import { workspaceManifestSha256 } from "../../packages/benchmark/src/report/raw-arm.js";
import { persistArmHome } from "../live-gate/paired-w2-live.js";
import { replayUserIngress } from "../live-gate/replay-user-ingress.js";
import { LIVE_MODEL, LIVE_PROVIDER, writeW1ShapedSession } from "../live-gate/w1-session-jsonl.js";
import { buildW2SyntheticCorpus } from "../w2-gate/corpus.js";
import { enableExperimentalProductRuntime } from "../helpers/product-harness.js";

it.each(["ct-00", "tu-00", "tu-08"])("restores %s receipts for product compaction without changing frozen messages", async (caseId) => {
  const restoreRuntimeMode = enableExperimentalProductRuntime();
  const root = mkdtempSync(join(tmpdir(), "pcr-live-replay-"));
  const sessionFile = join(root, "session.jsonl");
  const item = buildW2SyntheticCorpus().find((item) => item.id === caseId)!;
  const frozen = writeW1ShapedSession({ sessionFile, cwd: root, item, seed: 0 });
  const original = readFileSync(sessionFile, "utf8");
  const hooks = new Map<string, (event: any, ctx: any) => Promise<any>>();
  const createExtension = () => register({ on(name, handler) { hooks.set(name, handler as never); }, registerTool() {}, registerCommand() {} });
  let extension = createExtension();
  const compact = async () => {
    const manager = SessionManager.open(sessionFile);
    const branch = manager.getBranch();
    const messages = branch.filter((entry) => entry.type === "message").map((entry) => entry.message);
    return hooks.get("session_before_compact")!({ reason: "manual", preparation: {
      tokensBefore: 12000, firstKeptEntryId: frozen.retainedTailId,
      messagesToSummarize: messages.slice(0, -1), retainedTail: messages.slice(-1),
    } }, { cwd: root, sessionManager: manager, model: { provider: LIVE_PROVIDER, id: LIVE_MODEL, contextWindow: 200192, maxTokens: 16384 }, abort() { throw new Error("aborted"); } });
  };
  try {
    expect(await compact()).toBeUndefined();
    await extension.release?.();
    await replayUserIngress(sessionFile, root);
    extension = createExtension();
    const restored = readFileSync(sessionFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(restored.filter((row) => row.ingressMetadata)).toHaveLength(2);
    expect(restored.map(({ ingressMetadata: _, ...row }) => JSON.stringify(row)).join("\n") + "\n").toBe(original);
    const result = await compact();
    expect(result?.compaction?.fromExtension).toBe(true);
    expect(result.compaction.summary).toContain(item.hardDirective);
    await extension.release?.();
    const artifactDir = join(root, "retained-arm");
    persistArmHome({ arm: "B1", cwd: root, sessionFile }, { ok: false, error: "fixture-ingress-failure" }, artifactDir);
    expect(existsSync(join(artifactDir, "FAILED"))).toBe(true);
    expect(readFileSync(join(artifactDir, "stderr.txt"), "utf8")).toBe("fixture-ingress-failure");
    expect(readFileSync(join(artifactDir, "store.sha256"), "utf8").trim()).toBe(workspaceManifestSha256(join(root, ".context-runtime")));
    expect(readFileSync(join(artifactDir, "runtime-store-sanitized.sha256"), "utf8").trim()).toBe(workspaceManifestSha256(join(artifactDir, "runtime-store")));
    expect(readdirSync(join(artifactDir, "runtime-store"), { recursive: true }).some((path) => String(path).includes("master.key"))).toBe(false);
    rmSync(join(root, ".context-runtime"), { recursive: true });
    expect(existsSync(join(artifactDir, "runtime-store"))).toBe(true);
    await expect(replayUserIngress(sessionFile, root)).rejects.toThrow("PCR_REPLAY_INPUT_ALREADY_CAPTURED");
  } finally {
    restoreRuntimeMode();
    await extension.release?.();
    rmSync(root, { recursive: true, force: true });
  }
});
