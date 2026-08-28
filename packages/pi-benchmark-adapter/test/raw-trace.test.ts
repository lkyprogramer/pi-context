import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defineBenchmarkContracts, type RawTrace } from "../../benchmark-contracts/src/index.js";
import { decodeSessionJsonl } from "../src/pi-message-codec.js";
import {
  captureRawTrace,
  replayRawTrace,
  type RawTraceCaptureInput,
  type ReplayMessage,
} from "../src/raw-trace.js";

const FULL_LOG = "line 1\nline 2\nERROR TS2322\nline 4";
const PICTURE_META = "data:image/png;base64,AAA";
const CJK_ERROR = "失败：端口已被占用 EADDRINUSE";

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function fixtureWithRawAndReducedToolResult(): RawTraceCaptureInput {
  return {
    sessionId: "s1",
    branchLeafId: "u2",
    modelRoute: { provider: "recorded", model: "reader-1" },
    systemPromptHash: "0".repeat(64),
    toolSchemaHash: "1".repeat(64),
    sessionEntries: [
      { type: "message", id: "u1", parentId: null, message: { role: "user", content: "fix build", timestamp: 1 } },
      {
        type: "message",
        id: "tool-1",
        parentId: "u1",
        message: {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "bash",
          content: [{ type: "text", text: "ERROR TS2322" }],
          isError: true,
          timestamp: 2,
        },
      },
    ],
    rawToolObservations: new Map([["call-1", { bytes: new TextEncoder().encode(FULL_LOG), mediaType: "text/plain" }]]),
  };
}

const fixture = fixtureWithRawAndReducedToolResult;

async function replayIntoMemory(trace: RawTrace, signal?: AbortSignal) {
  const messages: ReplayMessage[] = [];
  const receipt = await replayRawTrace(
    trace,
    {
      onMessage(message) {
        messages.push(message);
      },
    },
    signal,
  );
  return { ...receipt, messages };
}

describe("raw trace capture", () => {
  it("uses the pre-reducer raw tool observation", async () => {
    const trace = await captureRawTrace(fixtureWithRawAndReducedToolResult());
    expect(trace.entries.find((e) => e.entryId === "tool-1")?.contentSha256).toBe(sha256(FULL_LOG));
  });

  it("round-trips message order, toolCallId and branch leaf", async () => {
    const trace = await captureRawTrace(fixture());
    const replayed = await replayIntoMemory(trace);
    expect(replayed.messageDigest).toBe(trace.messageDigest);
    expect(replayed.branchLeafId).toBe(trace.boundary.leafId);
  });

  it("is idempotent across repeated captures", async () => {
    const first = await captureRawTrace(fixture());
    const second = await captureRawTrace(fixture());
    const third = await captureRawTrace(structuredClone(fixture()));
    expect(first.rawTraceSha256).toBe(second.rawTraceSha256);
    expect(second.rawTraceSha256).toBe(third.rawTraceSha256);
    expect(first.messageDigest).toBe(third.messageDigest);
  });

  it("preserves parallel tool result order and CJK/ANSI/image metadata", async () => {
    const ansi = "\u001b[31mERROR\u001b[0m 构建失败";
    const input: RawTraceCaptureInput = {
      ...fixture(),
      sessionEntries: [
        { type: "message", id: "u1", parentId: null, message: { role: "user", content: CJK_ERROR, timestamp: 1 } },
        {
          type: "message",
          id: "t1",
          parentId: "u1",
          message: { role: "toolResult", toolCallId: "c1", toolName: "bash", content: ansi, timestamp: 2 },
        },
        {
          type: "message",
          id: "t2",
          parentId: "u1",
          message: { role: "toolResult", toolCallId: "c2", toolName: "read", content: PICTURE_META, timestamp: 2 },
        },
      ],
      rawToolObservations: new Map([
        ["c1", { bytes: new TextEncoder().encode(ansi), mediaType: "text/plain" }],
        ["c2", { bytes: new TextEncoder().encode(PICTURE_META), mediaType: "image/png" }],
      ]),
    };
    const trace = await captureRawTrace(input);
    expect(trace.entries.map((e) => e.entryId)).toEqual(["u1", "t1", "t2"]);
    expect(trace.entries.find((e) => e.entryId === "t1")?.contentSha256).toBe(sha256(ansi));
    expect(trace.entries.find((e) => e.entryId === "t2")?.contentSha256).toBe(sha256(PICTURE_META));
  });

  it("marks missing raw observation degraded instead of fabricating bytes", async () => {
    const input: RawTraceCaptureInput = {
      ...fixture(),
      rawToolObservations: new Map(),
    };
    const trace = await captureRawTrace(input);
    const tool = trace.entries.find((e) => e.entryId === "tool-1");
    expect(tool?.contentSha256).toBe(sha256("ERROR TS2322"));
    expect(tool?.degraded).toBe(true);
    expect(tool?.contentSha256).not.toBe(sha256(FULL_LOG));
  });

  it("does not publish a partial trace after cancel", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(captureRawTrace(Object.assign(fixture(), { signal: controller.signal }))).rejects.toThrow(/abort/i);
  });

  it("retains compaction entries and branch metadata", async () => {
    const jsonl = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/session-v3.jsonl"), "utf8");
    const decoded = decodeSessionJsonl(jsonl).filter((e) => e.type !== "session");
    const trace = await captureRawTrace({
      ...fixture(),
      branchLeafId: "u2",
      sessionEntries: decoded.map((e) => e.raw),
      rawToolObservations: new Map([["call-1", { bytes: new TextEncoder().encode(FULL_LOG), mediaType: "text/plain" }]]),
    });
    expect(trace.entries.some((e) => e.entryId === "cmp-1")).toBe(true);
    expect(trace.boundary.leafId).toBe("u2");
    expect(trace.entries.find((e) => e.entryId === "tool-1")?.contentSha256).toBe(sha256(FULL_LOG));
  });

  it("does not leak oracle or hidden continuation into the raw trace", async () => {
    const poisoned = {
      ...fixture(),
      sessionEntries: [
        ...fixture().sessionEntries,
        { type: "message", id: "hidden", parentId: "u1", oracle: { answer: "secret-oracle" }, hiddenContinuation: { task: "deploy" } },
      ],
    };
    const trace = await captureRawTrace(poisoned);
    const json = JSON.stringify(trace);
    expect(json).not.toMatch(/secret-oracle|hiddenContinuation|deploy/);
    expect("oracle" in trace).toBe(false);
    defineBenchmarkContracts().parseRawTrace(trace);
  });
});
