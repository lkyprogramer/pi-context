import { performance } from "node:perf_hooks";
import { captureUserDirectives } from "../../packages/kernel/src/directives/capture.js";
import { admitEvidence } from "../../packages/kernel/src/evidence/admit.js";
import { captureObservation, decodeObservationText } from "../../packages/kernel/src/ingress/raw-capture.js";
import { reduceBashLog } from "../../packages/kernel/src/reducers/bash.js";
import { reduceMutationResult } from "../../packages/kernel/src/reducers/file-mutation.js";
import { reduceReadResult } from "../../packages/kernel/src/reducers/read.js";
import { reduceSearchResult } from "../../packages/kernel/src/reducers/search.js";
import { reduceTestLog } from "../../packages/kernel/src/reducers/test-log.js";
import { buildProactiveRecallPage } from "../../packages/kernel/src/retrieval/proactive-query.js";
import { buildRetrievalPage } from "../../packages/kernel/src/retrieval/page-builder.js";
import { readEvidenceById } from "../../packages/kernel/src/retrieval/exact-read.js";
import type { EncryptedBlobStore } from "../../packages/storage/src/blob-store.js";
import type { SyntheticCase } from "./corpus.js";

export interface ArmMetrics {
  tokens: number;
  quality: number;
  recovered: boolean;
  hookMs: number;
  visible: string;
  pageQuotes: string[];
  recalled: boolean;
  silent: boolean;
  relevantHits: number;
  pageSize: number;
}

function tokensOf(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function reduceRaw(item: SyntheticCase): { visibleText: string; facts: unknown[] } {
  if (item.toolName === "test") return reduceTestLog(item.raw, { exitCode: 1, rawBlobId: "blob_eval" });
  if (item.toolName === "bash") return reduceBashLog(item.raw, { exitCode: 1, rawBlobId: "blob_eval" });
  if (item.toolName === "grep") return reduceSearchResult(item.raw, { query: item.path });
  if (item.toolName === "read") {
    return reduceReadResult(item.raw, { path: item.path, truncated: item.raw.length > 4000 });
  }
  if (item.toolName === "ls") {
    return reduceMutationResult(item.raw, { toolName: "ls", path: item.path === "." ? "." : item.path });
  }
  return { visibleText: item.raw.slice(0, 200), facts: [{ kind: "note", value: "ok" }] };
}

function containsNeedles(text: string, needles: string[]): boolean {
  return needles.every((needle) => text.includes(needle) || (needle === "exit=" && /exit=\d+/.test(text)));
}

export async function runA0(item: SyntheticCase): Promise<ArmMetrics> {
  return {
    tokens: tokensOf(item.raw),
    quality: 1,
    recovered: false,
    hookMs: 0,
    visible: item.raw,
    pageQuotes: [],
    recalled: false,
    silent: true,
    relevantHits: 0,
    pageSize: 0,
  };
}

export async function runW1Arm(
  item: SyntheticCase,
  blobs: EncryptedBlobStore,
  opts: { recall: boolean },
): Promise<ArmMetrics> {
  const started = performance.now();
  const directives = captureUserDirectives({
    sourceClass: "authenticated-user",
    text: item.userText,
    messageId: item.id,
  });
  const observation = await captureObservation(
    {
      operationId: `op_${item.id}`,
      cursor: {
        workspaceId: "w1",
        sessionId: "s1",
        leafId: null,
        lineageHash: "lin",
        modelKey: "eval",
        thinkingLevel: "off",
      },
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
  const reduced = reduceRaw(item);
  const evidence = admitEvidence({
    sourceClass: "trusted-tool",
    reducerFacts: reduced.facts.map((fact) => {
      const row = fact as { kind?: string; value?: unknown };
      return { kind: row.kind ?? "note", value: row.value ?? fact };
    }),
    observationId: `ob_${item.id}`,
    rawBlobId: observation.rawBlobId,
    observedAt: 1,
  });
  let recovered = false;
  if (observation.rawBlobId) {
    const read = await readEvidenceById(
      evidence[0]?.evidenceId ?? `ev_${item.id}`,
      { cursor: { workspaceId: "w1" }, maxBytes: 1_000_000 },
      {
        store: {
          async getEvidence() {
            return { workspaceId: "w1", contentHash: "a".repeat(64), rawBlobId: observation.rawBlobId };
          },
        },
        blobs,
      },
    );
    const plain = decodeObservationText(await blobs.read(observation.rawBlobId));
    recovered = plain === item.raw && read.receipt.evidenceId.length > 0;
  }
  const hookMs = performance.now() - started;
  const directiveText = directives.map((item) => item.quote).join("\n");
  let pageQuotes: string[] = [];
  let recalled = false;
  let silent = true;
  let relevantHits = 0;
  if (opts.recall) {
    const page = await buildProactiveRecallPage(
      {
        userText: item.userText,
        activePaths: [item.path],
        directives: item.recallNeeded ? [{ quote: item.recallTarget ?? item.oracleNeedles[0] ?? "" }] : [],
        maxTokens: 80,
      },
      {
        catalog: {
          async search() {
            if (!item.recallNeeded || !item.recallTarget) return [];
            return [{ evidenceId: `ev_old_${item.id}`, quote: item.recallTarget, path: item.path, tokens: 16, status: "active" }];
          },
        },
        injectionHistory: { isRecent: () => false },
        pages: { build: (query, selected, all) => buildRetrievalPage(query, selected, all) },
      },
    );
    pageQuotes = page.items.map((row) => row.quote);
    recalled = item.recallNeeded && pageQuotes.some((quote) => item.recallTarget && quote.includes(item.recallTarget));
    silent = !item.recallNeeded && (page.abstained === true || page.items.every((row) => row.required));
    relevantHits = page.items.filter((row) => item.recallTarget && row.quote.includes(item.recallTarget)).length;
  }
  const visible = [reduced.visibleText, directiveText, ...pageQuotes].join("\n");
  const quality = containsNeedles(visible, item.oracleNeedles) || (opts.recall && recalled) ? 1 : 0;
  return {
    tokens: tokensOf(reduced.visibleText),
    quality,
    recovered,
    hookMs,
    visible,
    pageQuotes,
    recalled,
    silent,
    relevantHits,
    pageSize: pageQuotes.length,
  };
}

export async function denyCrossWorkspace(blobs: EncryptedBlobStore): Promise<boolean> {
  try {
    await readEvidenceById("ev_aaaaaaaa", { cursor: { workspaceId: "w-b" }, maxBytes: 16 }, {
      store: {
        async getEvidence() {
          return { workspaceId: "w-a", contentHash: "a".repeat(64), rawBlobId: "blob_missing" };
        },
      },
      blobs,
    });
    return false;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && (error as { code: string }).code === "PCR_RETRIEVAL_SCOPE_DENIED");
  }
}
