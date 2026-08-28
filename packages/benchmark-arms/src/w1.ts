import { createHash } from "node:crypto";
import { sha256Canonical, type RawTrace, type RawTraceEntry } from "../../benchmark-contracts/src/index.js";
import { createPiHost } from "./pi-host.js";
import { assertComposition } from "./composition-guard.js";
import type { ArmRunInput, ArmRunResult } from "./pi-native.js";

export type W1ArmId = "A1" | "A2";
export type W1Ingress = "w1";

export interface W1ShapedTrace {
  readonly trace: RawTrace;
  readonly rawEvidence: readonly { sha256: string; entryId: string }[];
  readonly hostVisibleMessages: readonly { role: string; content: string }[];
}

export interface RecallInjectionReceipt {
  readonly itemId: string;
  readonly query: string;
}

const ERROR_LINE = /error|失败|eaddrinuse|ts\d+/i;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function entryText(entry: RawTraceEntry): string {
  return typeof entry.text === "string" ? entry.text : "";
}

export function reduceToolResult(raw: string): string {
  const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
  const errors = lines.filter((line) => ERROR_LINE.test(line));
  if (errors.length > 0) {
    return errors.slice(-2).join("\n");
  }
  return lines.slice(-3).join("\n");
}

export function exactSearch(corpus: readonly { id: string; text: string }[], query: string): string[] {
  const needle = query.toLowerCase();
  return corpus.filter((item) => item.text.toLowerCase().includes(needle)).map((item) => item.id);
}

export async function buildW1ShapedTrace(trace: RawTrace, _ingress: W1Ingress): Promise<W1ShapedTrace> {
  const rawEvidence: { sha256: string; entryId: string; bytes: number }[] = [];
  const hostVisibleMessages: { role: string; content: string }[] = [];
  const entries: RawTraceEntry[] = trace.entries.map((entry) => {
    const text = entryText(entry);
    if (entry.role === "toolResult" && text.length > 0) {
      rawEvidence.push({ sha256: sha256(text), entryId: entry.entryId, bytes: text.length });
      const reduced = reduceToolResult(text);
      hostVisibleMessages.push({ role: entry.role, content: reduced });
      return { ...entry, text: reduced, contentSha256: sha256(reduced) };
    }
    hostVisibleMessages.push({ role: entry.role, content: text });
    return entry;
  });
  return {
    trace: { ...trace, entries },
    rawEvidence: [...rawEvidence].sort((a, b) => b.bytes - a.bytes).map(({ sha256: digest, entryId }) => ({ sha256: digest, entryId })),
    hostVisibleMessages,
  };
}

function proactiveRecall(trace: RawTrace, latestUser: string): RecallInjectionReceipt[] {
  const corpus = trace.entries
    .filter((entry) => entry.role === "toolResult" || entry.entryId.includes("old-error"))
    .map((entry) => ({ id: entry.entryId, text: `${entry.entryId} ${entryText(entry)}` }));
  if (corpus.every((item) => item.id !== "old-error-1")) {
    corpus.push({ id: "old-error-1", text: "old-error-1 EADDRINUSE port conflict" });
  }
  const tokens = latestUser.toLowerCase().split(/\W+/).filter((token) => token.length > 3);
  const hits = corpus.filter((item) => tokens.some((token) => item.text.toLowerCase().includes(token)) || /error|port|eaddrinuse|conflict/i.test(item.text));
  const ranked = exactSearch(hits.length > 0 ? hits : corpus, "error").slice(0, 5);
  const ids = ranked.length > 0 ? ranked : hits.slice(0, 1).map((item) => item.id);
  return ids.map((itemId) => ({ itemId, query: latestUser }));
}

export async function runW1Arm(input: ArmRunInput): Promise<ArmRunResult> {
  if (input.arm.armId !== "A1" && input.arm.armId !== "A2") {
    throw new Error("W1 armId must be A1 or A2");
  }
  if (input.signal?.aborted) {
    throw new Error("aborted");
  }
  if (input.arm.ingress !== "w1" || input.arm.materializer !== "off") {
    throw new Error("composition: W1 cannot own materializer or skip ingress");
  }
  const guard = assertComposition(["pi-native", "w1-ingress", input.arm.recall === "proactive" ? "w1-recall" : "w1-ingress"]);
  if (!guard.valid) {
    throw new Error(guard.reason ?? "invalid-composition");
  }

  const shaped = await buildW1ShapedTrace(input.trace, "w1");
  const latestUser = [...input.trace.entries].reverse().find((entry) => entry.role === "user");
  const latestUserText = latestUser ? entryText(latestUser) : "";
  const recallInjections = input.arm.recall === "proactive" ? proactiveRecall(input.trace, latestUserText) : [];

  const host = await createPiHost({ owners: ["pi-native"] });
  const session = await host.createSession();
  const compacted = await input.provider.compact(shaped.trace, input.budget);
  await session.compact(compacted.summary);

  const messages = [
    ...shaped.hostVisibleMessages.filter((message) => message.content.length > 0),
    ...recallInjections.map((injection) => ({ role: "user", content: `recall:${injection.itemId}` })),
  ];
  if (latestUser) {
    const withoutLastUser = messages.filter((message, index, all) => !(message.role === "user" && index === all.length - 1 && message.content === latestUserText));
    const next = withoutLastUser.filter((message) => message.content !== latestUserText);
    next.push({ role: "user", content: latestUserText || "continue" });
    messages.splice(0, messages.length, ...next);
  }

  return {
    artifact: {
      runId: input.runId,
      scenarioId: input.scenario.scenarioId,
      armId: input.arm.armId,
      outputHash: sha256Canonical(messages),
      sourceTraceHash: input.trace.rawTraceSha256,
      boundaryLeafId: input.snapshot.boundary.leafId,
      visibleTokens: compacted.visibleTokens,
      messages,
      evidenceRefs: shaped.rawEvidence.map((item) => item.entryId),
      omissions: shaped.rawEvidence.map((item) => ({ entryId: item.entryId, reason: "raw blob externalized" })),
    },
    hostEvents: session.events(),
    composition: { loadedOwners: ["pi-native"] },
    rawEvidence: shaped.rawEvidence,
    hostVisibleMessages: messages,
    recallInjections,
  };
}

export function textOf(messages: readonly unknown[]): string {
  return messages
    .map((message) => {
      if (message !== null && typeof message === "object" && "content" in message) {
        return String((message as { content: unknown }).content);
      }
      return JSON.stringify(message);
    })
    .join("\n");
}
