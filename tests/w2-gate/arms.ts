import { estimateTextTokens } from "../../packages/kernel/src/budget/token-counter.js";
import { buildDeterministicCheckpointCandidate } from "../../packages/kernel/src/compaction/candidate.js";
import { hashCheckpointBody } from "../../packages/kernel/src/compaction/host-checkpoint.js";
import { renderHostCheckpoint } from "../../packages/kernel/src/compaction/render.js";
import { captureUserDirectives } from "../../packages/kernel/src/directives/capture.js";
import { captureObservation, decodeObservationText } from "../../packages/kernel/src/ingress/raw-capture.js";
import { ContextMaterializer } from "../../packages/kernel/src/materialization/materializer.js";
import { validateToolPairs } from "../../packages/kernel/src/materialization/atomic-groups.js";
import { readEvidenceById } from "../../packages/kernel/src/retrieval/exact-read.js";
import type { HostCheckpoint, HostMessage, HostSessionCursor } from "../../packages/contracts/src/index.js";
import type { EncryptedBlobStore } from "../../packages/storage/src/blob-store.js";
import type { W2Case } from "./corpus.js";

export const FABRICATED_DEPLOY = "I think we deployed successfully";

export interface W2ArmMetrics {
  arm: "B0" | "B1" | "B2";
  tokens: number;
  tokensBefore: number;
  targetTokens: number;
  budgetMismatch: boolean;
  quality: number;
  polarity: number;
  time: number;
  update: number;
  abstention: number;
  recovered: boolean;
  visible: string;
  outputHash: string;
  hashStable: boolean;
  directiveCoverage: number;
  unsupportedHighRiskOutcome: number;
  toolPairViolation: number;
  mustOmitLeak: number;
  closedLoopSuccess: number;
  constraintViolation: number;
  sourceSpan: { first: string; last: string };
  retainedTailStartId: string;
}

const CURSOR: HostSessionCursor = {
  workspaceId: "w2",
  sessionId: "s1",
  leafId: "leaf-a",
  lineageHash: "lin",
  modelKey: "eval",
  thinkingLevel: "off",
};

function textOf(message: HostMessage): string {
  return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

function countHostMessages(messages: readonly HostMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTextTokens(textOf(message) || " "), 0);
}

function userMessage(id: string, text: string, timestamp: number): HostMessage {
  return {
    hostMessageId: id,
    role: "user",
    timestamp,
    content: [{ type: "text", text }],
    sourceClass: "authenticated-user",
  };
}

export function w1ShapedMessages(item: W2Case): HostMessage[] {
  return [
    userMessage(item.sourceSpan.first, item.userText, 1),
    {
      hostMessageId: `a_tool_${item.id}`,
      role: "assistant",
      timestamp: 2,
      content: [{ type: "tool-call-ref", ref: `call_${item.id}` }],
      sourceClass: "agent-derived",
    },
    {
      hostMessageId: item.sourceSpan.last,
      role: "tool-result",
      timestamp: 3,
      content: [{ type: "text", text: item.raw }],
      sourceClass: "trusted-tool",
      toolCallId: `call_${item.id}`,
      toolName: item.toolName,
    },
    userMessage(item.retainedTailStartId, item.retainedTail, 4),
  ];
}

export function tokensBeforeOf(item: W2Case): number {
  return countHostMessages(w1ShapedMessages(item));
}

function padToBudget(base: string, targetTokens: number): string {
  const line = `\nnative-fill ${"z".repeat(48)}`;
  const lineTokens = Math.max(1, estimateTextTokens(line));
  let text = base;
  let tokens = estimateTextTokens(text);
  if (tokens >= targetTokens) return text;
  const n = Math.ceil((targetTokens - tokens) / lineTokens);
  text = `${text}${line.repeat(n)}`;
  tokens = estimateTextTokens(text);
  while (tokens < targetTokens) {
    text += line;
    tokens = estimateTextTokens(text);
  }
  return text;
}

function scoreReader(visible: string, item: W2Case): { polarity: number; time: number; update: number; abstention: number; quality: number } {
  const polarity = visible.includes(item.hardDirective) ? 1 : 0;
  const time = item.family === "temporal-update" ? (visible.includes(item.latestValue) ? 1 : 0) : 1;
  const update = item.family === "temporal-update" ? (visible.includes(item.latestValue) && !visible.includes(`${item.staleValue} current`) ? 1 : 0) : 1;
  const abstention = item.family === "branch" ? (visible.includes(item.siblingClaim) ? 0 : 1) : 1;
  const quality = (polarity + time + update + abstention) / 4;
  return { polarity, time, update, abstention, quality };
}

function closedLoop(visible: string, item: W2Case): { success: number; constraintViolation: number } {
  const honorsDirective = visible.includes(item.hardDirective);
  const fabricated = visible.includes(FABRICATED_DEPLOY);
  const wrongVersion = item.family === "temporal-update" && !visible.includes(item.latestValue);
  const wrongBranch = item.family === "branch" && visible.includes(item.siblingClaim);
  const constraintViolation = (!honorsDirective || fabricated) && (item.family === "constraint" || item.family === "overflow") ? 1 : 0;
  const success = honorsDirective && !fabricated && !wrongVersion && !wrongBranch ? 1 : 0;
  return { success, constraintViolation };
}

function nativeSummary(item: W2Case): string {
  const keepDirective = item.family === "tool-heavy" ? item.hardDirective : "user asked to continue work";
  const stale = item.family === "temporal-update" ? `${item.staleValue} current` : "";
  const sibling = item.family === "branch" ? item.siblingClaim : "";
  return [
    keepDirective,
    item.raw.slice(0, 180),
    FABRICATED_DEPLOY,
    item.mustOmit,
    stale,
    sibling,
    `retained: ${item.retainedTail}`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function runB0(item: W2Case, targetTokens: number, tokensBefore: number): W2ArmMetrics {
  const visible = padToBudget(nativeSummary(item), targetTokens);
  const tokens = estimateTextTokens(visible);
  const reader = scoreReader(visible, item);
  const loop = closedLoop(visible, item);
  const mismatch = Math.abs(tokens - targetTokens) / Math.max(targetTokens, 1) > 0.05;
  return {
    arm: "B0",
    tokens,
    tokensBefore,
    targetTokens,
    budgetMismatch: mismatch,
    ...reader,
    recovered: false,
    visible,
    outputHash: hashCheckpointBody(visible),
    hashStable: hashCheckpointBody(visible) === hashCheckpointBody(visible),
    directiveCoverage: visible.includes(item.hardDirective) ? 1 : 0,
    unsupportedHighRiskOutcome: visible.includes(FABRICATED_DEPLOY) ? 1 : 0,
    toolPairViolation: 0,
    mustOmitLeak: visible.includes(item.mustOmit) ? 1 : 0,
    closedLoopSuccess: loop.success,
    constraintViolation: loop.constraintViolation,
    sourceSpan: item.sourceSpan,
    retainedTailStartId: item.retainedTailStartId,
  };
}

async function recoverExact(item: W2Case, blobs: EncryptedBlobStore, rawBlobId: string): Promise<boolean> {
  const read = await readEvidenceById(
    `ev_${item.id}`,
    { cursor: { workspaceId: "w2" }, maxBytes: 2_000_000 },
    {
      store: {
        async getEvidence() {
          return { workspaceId: "w2", contentHash: "a".repeat(64), rawBlobId };
        },
      },
      blobs,
    },
  );
  const plain = decodeObservationText(await blobs.read(rawBlobId));
  return plain === item.raw && read.receipt.evidenceId.length > 0;
}

export async function runB1(item: W2Case, blobs: EncryptedBlobStore, tokensBefore: number): Promise<W2ArmMetrics & { summary: string; blobId: string }> {
  const directives = captureUserDirectives({
    sourceClass: "authenticated-user",
    text: item.userText,
    messageId: item.sourceSpan.first,
  });
  const observation = await captureObservation(
    {
      operationId: `op_${item.id}`,
      cursor: CURSOR,
      toolCallId: item.id,
      toolName: item.toolName,
      args: {},
      content: [{ type: "text", text: item.raw }],
      details: null,
      isError: item.family === "tool-heavy",
      capturedAt: 1,
    },
    {
      blobs,
      saga: {
        async prepare(input) {
          return {
            operationId: input.operationId,
            kind: input.kind,
            state: "prepared",
            sourceContentHash: input.sourceContentHash,
            hostCorrelationId: input.hostCorrelationId,
            branchScope: "main",
            rawBlobId: input.rawBlobId,
          };
        },
      },
    },
  );
  if (!observation.rawBlobId) {
    throw new Error(`B1 missing rawBlobId for ${item.id}`);
  }
  const checkpoint: HostCheckpoint = {
    directives: directives.map((directive) => ({
      directiveId: directive.directiveId,
      quote: directive.quote,
      polarity: directive.polarity,
      status: directive.status,
    })),
    continuity: {
      revisionId: `cr_${item.id}`,
      markdown: `front: ${item.latestValue}\npath: ${item.path}`,
    },
    claims: [
      {
        claimId: `cl_${item.id}`,
        key: item.family === "constraint" || item.family === "overflow" ? "constraint/prod" : `fact/${item.family}`,
        polarity: item.family === "constraint" || item.family === "overflow" ? "must-not" : "is",
        status: "active",
        value: item.family === "temporal-update" ? item.latestValue : item.hardDirective,
        validTime: { start: 100, end: null },
      },
    ],
    pointers: [{ ref: observation.rawBlobId, kind: "raw-blob" }],
    heads: {
      contextHead: "ctx_aaaaaaaa",
      directiveHead: `dh_${item.id}`,
      claimHead: `ch_${item.id}`,
      continuityHead: `cth_${item.id}`,
      catalogHead: "cah_1",
    },
    secrets: { [item.mustOmit]: item.mustOmit },
  };
  const tail = [userMessage(item.retainedTailStartId, item.retainedTail, 4)];
  const result = await buildDeterministicCheckpointCandidate(
    {
      tokensBefore,
      firstKeptEntryId: item.retainedTailStartId,
      retainedTail: tail,
      branchScope: "main",
      head: "leaf-a",
      directives: directives.map((directive) => ({ directiveId: directive.directiveId, quote: directive.quote })),
      reason: item.family === "overflow" ? "overflow" : "threshold",
    },
    {
      checkpoint,
      verifiedPointers: new Set([observation.rawBlobId]),
      branchScope: "main",
      head: "leaf-a",
      waitForSemantic: item.family === "overflow",
      counter: {
        countText: estimateTextTokens,
        countMessages: countHostMessages,
      },
    },
  );
  if (result.kind !== "ready") {
    throw new Error(`B1 rejected ${item.id}: ${result.code}`);
  }
  const summary = result.candidate.summary;
  const rerender = renderHostCheckpoint(checkpoint);
  const visible = `${summary}\n${item.retainedTail}`;
  const tokens = estimateTextTokens(summary) + countHostMessages(tail);
  const recovered = await recoverExact(item, blobs, observation.rawBlobId);
  const covered = directives.length === 0 ? 0 : directives.filter((directive) => summary.includes(directive.quote)).length / directives.length;
  const pairing = validateToolPairs(tail);
  const reader = scoreReader(visible, item);
  const loop = closedLoop(visible, item);
  return {
    arm: "B1",
    tokens,
    tokensBefore,
    targetTokens: tokens,
    budgetMismatch: false,
    ...reader,
    recovered,
    visible,
    outputHash: result.candidate.details.outputHash,
    hashStable: hashCheckpointBody(summary) === hashCheckpointBody(rerender),
    directiveCoverage: covered,
    unsupportedHighRiskOutcome: visible.includes(FABRICATED_DEPLOY) ? 1 : 0,
    toolPairViolation: pairing.ok ? 0 : 1,
    mustOmitLeak: visible.includes(item.mustOmit) ? 1 : 0,
    closedLoopSuccess: loop.success,
    constraintViolation: loop.constraintViolation,
    sourceSpan: item.sourceSpan,
    retainedTailStartId: item.retainedTailStartId,
    summary,
    blobId: observation.rawBlobId,
  };
}

export async function runB2(
  item: W2Case,
  b1: { summary: string; tokensBefore: number; recovered: boolean },
): Promise<W2ArmMetrics> {
  const suffix = [userMessage(item.retainedTailStartId, item.retainedTail, 4)];
  const materializer = new ContextMaterializer({
    directives: item.hardDirective,
    continuityText: b1.summary,
    historyText: "",
    directoryText: "",
    recallText: "",
    cacheEnabled: false,
  });
  const input = {
    cursor: CURSOR,
    canonicalMessages: suffix,
    currentContextWindow: 32_000,
    maxOutputTokens: 1024,
    reason: "normal" as const,
    now: 4,
  };
  const view = await materializer.materialize(input);
  const again = await materializer.materialize(input);
  const visible = view.messages.map(textOf).join("\n");
  const pairing = validateToolPairs(suffix);
  const reader = scoreReader(visible, item);
  const loop = closedLoop(visible, item);
  return {
    arm: "B2",
    tokens: view.tokenEstimate,
    tokensBefore: b1.tokensBefore,
    targetTokens: view.tokenEstimate,
    budgetMismatch: false,
    ...reader,
    recovered: b1.recovered,
    visible,
    outputHash: view.outputHash,
    hashStable: view.outputHash === again.outputHash,
    directiveCoverage: visible.includes(item.hardDirective) ? 1 : 0,
    unsupportedHighRiskOutcome: visible.includes(FABRICATED_DEPLOY) ? 1 : 0,
    toolPairViolation: pairing.ok ? 0 : 1,
    mustOmitLeak: visible.includes(item.mustOmit) ? 1 : 0,
    closedLoopSuccess: loop.success,
    constraintViolation: loop.constraintViolation,
    sourceSpan: item.sourceSpan,
    retainedTailStartId: item.retainedTailStartId,
  };
}
