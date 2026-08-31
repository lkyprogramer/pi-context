import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createFileTraceStore,
  createTraceCapture,
  type CapturedTrace,
  type TraceCaptureStore,
} from "@pcr/benchmark";

const roots: string[] = [];
const CLUSTERS = {
  temporal: ["temporal-00"],
  negation: ["negation-00"],
  "tool-noise": ["tool-noise-00"],
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function dataRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "t41-"));
  roots.push(root);
  return root;
}

function sessionJsonl(overrides: { workspaceId?: string; sessionId?: string; secret?: string } = {}): string {
  const workspaceId = overrides.workspaceId ?? "ws-t41";
  const sessionId = overrides.sessionId ?? "session-t41";
  const secret = overrides.secret ?? "sk-live-t41-secret";
  const lines = [
    { type: "message", id: "u1", role: "user", workspaceId, sessionId, text: "keep version 7; token sk-live-t41-secret" },
    { type: "message", id: "t1", role: "toolResult", workspaceId, sessionId, text: `ran /Users/luo/.ssh/id_ed25519 with ${secret}` },
    { type: "message", id: "a1", role: "assistant", workspaceId, sessionId, text: "contact ops@example.com" },
  ];
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

function memoryStore(): TraceCaptureStore & { traces: CapturedTrace[] } {
  const traces: CapturedTrace[] = [];
  return {
    traces,
    async write(trace) {
      traces.push(trace);
    },
  };
}

async function runT41Fixture() {
  const store = memoryStore();
  const capture = createTraceCapture({
    corpusId: "pcr-bench",
    clusters: CLUSTERS,
    store,
  });
  const first = await capture.capture({
    clusterId: "tool-noise",
    workspaceId: "ws-t41",
    sessionId: "session-t41",
    sessionJsonl: sessionJsonl(),
    workspaceSnapshot: { files: { "notes.txt": "token sk-live-t41-secret" } },
  });
  expect(first.clusterId).toBe("tool-noise");
  expect(first.traceId).toMatch(/^[a-f0-9]{64}$/u);
  expect(first.sessionJsonlHash).toMatch(/^[a-f0-9]{64}$/u);
  expect(first.workspaceSnapshotHash).toMatch(/^[a-f0-9]{64}$/u);
  expect(first.redactionReportHash).toMatch(/^[a-f0-9]{64}$/u);
  const second = await capture.capture({
    clusterId: "tool-noise",
    workspaceId: "ws-t41",
    sessionId: "session-t41",
    sessionJsonl: sessionJsonl(),
    workspaceSnapshot: { files: { "notes.txt": "token sk-live-t41-secret" } },
  });
  expect(second).toEqual(first);
  expect(JSON.stringify(first)).not.toContain("sk-live-t41-secret");
  expect(JSON.stringify(first)).not.toContain("ops@example.com");
  return { ok: true as const, task: "T41" as const, trace: first };
}

describe("T41 Real trace capture and anonymization", () => {
  it("real_trace_capture_and_anonymization", async () => {
    await expect(runT41Fixture()).resolves.toMatchObject({ ok: true, task: "T41" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createTraceCapture({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_TRACE_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed capture input and unknown clusters", async () => {
    const capture = createTraceCapture({ corpusId: "pcr-bench", clusters: CLUSTERS, store: memoryStore() });
    await expect(capture.capture({} as never)).rejects.toMatchObject({ code: "PCR_TRACE_INPUT_INVALID" });
    await expect(capture.capture({
      clusterId: "synthetic-clone",
      workspaceId: "ws-t41",
      sessionId: "session-t41",
      sessionJsonl: sessionJsonl(),
      workspaceSnapshot: {},
    })).rejects.toMatchObject({ code: "PCR_TRACE_INPUT_INVALID" });
  });

  it("replays equal hashes for the same redacted session", async () => {
    const capture = createTraceCapture({ corpusId: "pcr-bench", clusters: CLUSTERS, store: memoryStore() });
    const input = {
      clusterId: "temporal",
      workspaceId: "ws-t41",
      sessionId: "session-t41",
      sessionJsonl: sessionJsonl(),
      workspaceSnapshot: { files: { "a.txt": "keep version 7" } },
    };
    const first = await capture.capture(input);
    const second = await capture.capture(input);
    expect(second).toEqual(first);
  });

  it("rejects session rows from another workspace", async () => {
    const capture = createTraceCapture({ corpusId: "pcr-bench", clusters: CLUSTERS, store: memoryStore() });
    await expect(capture.capture({
      clusterId: "temporal",
      workspaceId: "ws-t41",
      sessionId: "session-t41",
      sessionJsonl: sessionJsonl({ workspaceId: "ws-other" }),
      workspaceSnapshot: {},
    })).rejects.toMatchObject({ code: "PCR_TRACE_SCOPE_MISMATCH" });
  });

  it("stops at the abort boundary before writing", async () => {
    let wrote = 0;
    const capture = createTraceCapture({
      corpusId: "pcr-bench",
      clusters: CLUSTERS,
      store: {
        async write() {
          wrote += 1;
        },
      },
    });
    await expect(capture.capture({
      clusterId: "temporal",
      workspaceId: "ws-t41",
      sessionId: "session-t41",
      sessionJsonl: sessionJsonl(),
      workspaceSnapshot: {},
      signal: AbortSignal.abort(),
    })).rejects.toThrow();
    expect(wrote).toBe(0);
  });

  it("writes redacted artifacts to a file-backed store", async () => {
    const root = dataRoot();
    const store = createFileTraceStore({ root, corpusId: "pcr-bench" });
    const capture = createTraceCapture({ corpusId: "pcr-bench", clusters: CLUSTERS, store });
    const first = await capture.capture({
      clusterId: "negation",
      workspaceId: "ws-t41",
      sessionId: "session-t41",
      sessionJsonl: sessionJsonl(),
      workspaceSnapshot: { files: { "notes.txt": "mail ops@example.com" } },
    });
    const disk = JSON.parse(await readFile(join(root, "trace.json"), "utf8")) as CapturedTrace;
    expect(disk).toEqual(first);
    const jsonl = await readFile(join(root, "session.redacted.jsonl"), "utf8");
    expect(jsonl).not.toContain("sk-live-t41-secret");
    expect(jsonl).not.toContain("ops@example.com");
    expect(jsonl).not.toContain("/Users/luo/.ssh/id_ed25519");
  });
});
