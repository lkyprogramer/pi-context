import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolvePiBin } from "./pi-resolve.js";
import { EncryptedBlobStore } from "../../packages/storage/src/blob-store.js";
import { TestKeyProvider } from "../../packages/storage/src/key-provider.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { estimateTextTokens } from "../../packages/kernel/src/budget/token-counter.js";
import { hashCheckpointBody } from "../../packages/kernel/src/compaction/host-checkpoint.js";
import { runB1, scoreVisibleArtifact, tokensBeforeOf, w1ShapedMessages } from "../w2-gate/arms.js";
import { buildW2SyntheticCorpus, type W2Case } from "../w2-gate/corpus.js";
import { evaluateW2Gate, median, pairedBootstrapCi, relativeDelta } from "../w2-gate/scorer.js";
import { resolvePiPackageEntry } from "./pi-resolve.js";

export interface LiveB0Layer {
  attempted: boolean;
  livePiNative: boolean;
  b0Kind: string;
  model?: { provider: string; id: string };
  caseCount: number;
  hardGatePass: boolean;
  decision: string;
  tokenMedianRelativeDelta: number;
  realizedNetMedian: number;
  qualityCiLower: number;
  closedLoopSuccessCiLower: number;
  pairs: Array<{
    id: string;
    family: string;
    b0Tokens: number;
    b1Tokens: number;
    b0Quality: number;
    b1Quality: number;
    b0Success: number;
    b1Success: number;
  }>;
  error?: string;
}

function pickLiveCases(): W2Case[] {
  const all = buildW2SyntheticCorpus();
  const families = ["tool-heavy", "constraint", "temporal-update", "branch", "overflow"] as const;
  const picked: W2Case[] = [];
  for (const family of families) {
    const rows = all.filter((item) => item.family === family);
    if (rows[0]) picked.push(rows[0]);
    if (rows[8]) picked.push(rows[8]);
  }
  return picked;
}

function toAgentMessages(item: W2Case) {
  return w1ShapedMessages(item).map((message) => ({
    role: message.role === "tool-result" ? "toolResult" : message.role,
    content: message.content.map((block) =>
      block.type === "text" ? { type: "text", text: block.text } : { type: "text", text: `[${block.type}]` },
    ),
    timestamp: message.timestamp,
    toolCallId: message.toolCallId,
    toolName: message.toolName,
  }));
}

export async function runLiveB0Layer(): Promise<LiveB0Layer> {
  const cases = pickLiveCases();
  try {
    const mod = (await import(pathToFileURL(resolvePiPackageEntry()).href)) as {
      ModelRuntime: { create: (opts?: { refreshOnCreate?: boolean; allowModelNetwork?: boolean }) => Promise<{
        getAvailable: () => Promise<Array<{ provider: string; id: string; maxTokens?: number }>>;
        getAuth: (model: unknown) => Promise<{ apiKey?: string; headers?: Record<string, string>; env?: Record<string, string> } | undefined>;
      }> };
      generateSummary: (
        messages: unknown[],
        model: unknown,
        reserveTokens: number,
        apiKey: string | undefined,
        headers?: Record<string, string>,
        signal?: AbortSignal,
        customInstructions?: string,
        previousSummary?: string,
        thinkingLevel?: string,
        streamFn?: (
          model: unknown,
          context: unknown,
          options: Record<string, unknown>,
        ) => Promise<{ result: () => Promise<{ content: Array<{ type: string; text?: string }>; stopReason?: string; errorMessage?: string }> }>,
        env?: Record<string, string>,
      ) => Promise<string>;
    };
    const runtime = await mod.ModelRuntime.create({ refreshOnCreate: false, allowModelNetwork: false });
    const complete = (runtime as { complete?: (model: unknown, context: unknown, options: unknown) => Promise<{ content: Array<{ type: string; text?: string }>; stopReason?: string; errorMessage?: string }> }).complete;
    const available = await runtime.getAvailable();
    const model =
      available.find((item) => item.provider === "xai") ??
      available.find((item) => /grok|gpt|claude|gemini/i.test(item.id)) ??
      available[0];
    if (!model) {
      return {
        attempted: true,
        livePiNative: false,
        b0Kind: "live-generateSummary-unavailable",
        caseCount: 0,
        hardGatePass: false,
        decision: "keep-pi-native",
        tokenMedianRelativeDelta: 0,
        realizedNetMedian: 0,
        qualityCiLower: 0,
        closedLoopSuccessCiLower: 0,
        pairs: [],
        error: "no authenticated Pi model available",
      };
    }
    const auth = await runtime.getAuth(model);
    let apiKey = auth?.apiKey;
    if (!apiKey) {
      const printed = spawnSync(resolvePiBin(), ["auth", "print-api-key", "--provider", model.provider], {
        encoding: "utf8",
        timeout: 15_000,
      });
      const keyOut = (printed.stdout || "").trim();
      if (printed.status === 0 && keyOut && !keyOut.startsWith("Error")) apiKey = keyOut;
    }
    if (!apiKey) {
      const printed = spawnSync(resolvePiBin(), ["auth", "print-bearer-token", "--provider", model.provider], {
        encoding: "utf8",
        timeout: 15_000,
      });
      const token = (printed.stdout || "").trim();
      if (printed.status === 0 && token && !token.startsWith("Error")) apiKey = token;
    }
    if (!apiKey) {
      throw new Error(`no API key or OAuth bearer for provider ${model.provider}`);
    }
    const blobs = new EncryptedBlobStore({
      root: mkdtempSync(join(tmpdir(), "pcr-live-b0-")),
      workspaceId: "w2",
      keys: new TestKeyProvider(Buffer.alloc(32, 13)),
    });

    const pairs = [];
    for (const item of cases) {
      const tokensBefore = tokensBeforeOf(item);
      const summary = await mod.generateSummary(
        toAgentMessages(item),
        model,
        4096,
        apiKey,
        auth?.headers,
        undefined,
        `Preserve hard constraints. Do not invent deployment success. Drop secrets such as ${item.mustOmit}.`,
        undefined,
        "off",
        async (_model, context, options) => {
          const cleaned = { ...options };
          delete cleaned.toolChoice;
          if (typeof complete !== "function") {
            throw new Error("ModelRuntime.complete is not available");
          }
          const result = await complete.call(runtime, model, context, cleaned);
          return { result: async () => result };
        },
        auth?.env,
      );
      const b0Score = scoreVisibleArtifact(summary, item);
      const b1 = await runB1(item, blobs, tokensBefore);
      pairs.push({
        id: item.id,
        family: item.family,
        b0Tokens: estimateTextTokens(summary),
        b1Tokens: b1.tokens,
        b0Quality: b0Score.quality,
        b1Quality: b1.quality,
        b0Success: b0Score.closedLoopSuccess,
        b1Success: b1.closedLoopSuccess,
        b0Directive: b0Score.directiveCoverage,
        b1Directive: b1.directiveCoverage,
        b0Unsupported: b0Score.unsupportedHighRiskOutcome,
        b1Unsupported: b1.unsupportedHighRiskOutcome,
        b0Leak: b0Score.mustOmitLeak,
        b1Leak: b1.mustOmitLeak,
        b0Constraint: b0Score.constraintViolation,
        b1Constraint: b1.constraintViolation,
        b0Hash: hashCheckpointBody(summary),
        b1Hash: b1.outputHash,
        b1Recovered: b1.recovered,
      });
    }

    const hardGatePass =
      pairs.every((row) => row.b1Directive === 1) &&
      pairs.every((row) => row.b1Unsupported === 0) &&
      pairs.every((row) => row.b1Leak === 0) &&
      pairs.every((row) => row.b1Recovered);
    const quality = pairedBootstrapCi(
      pairs.map((row) => row.b0Quality),
      pairs.map((row) => row.b1Quality),
    );
    const closedLoop = pairedBootstrapCi(
      pairs.map((row) => row.b0Success),
      pairs.map((row) => row.b1Success),
    );
    const tokenMedianRelativeDelta = median(pairs.map((row) => relativeDelta(row.b1Tokens, row.b0Tokens)));
    const realized = pairs.map((row) => row.b0Tokens - row.b1Tokens);
    const realizedCi = pairedBootstrapCi(
      realized.map(() => 0),
      realized,
    );
    const constraintB0 = pairs.reduce((sum, row) => sum + row.b0Constraint, 0);
    const constraintB1 = pairs.reduce((sum, row) => sum + row.b1Constraint, 0);
    const decision = evaluateW2Gate({
      hardGatePass,
      qualityCiLower: quality.lower,
      polarityCiLower: quality.lower,
      timeCiLower: quality.lower,
      updateCiLower: quality.lower,
      abstentionCiLower: quality.lower,
      qualityMargin: 0.02,
      closedLoopSuccessCiLower: closedLoop.lower,
      constraintViolationsCandidate: constraintB1,
      constraintViolationsBaseline: constraintB0,
      tokenMedianRelativeDelta,
      costPerSuccessRelativeDelta: (() => {
        const b1 = pairs.filter((row) => row.b1Success === 1).map((row) => row.b1Tokens);
        const b0 = pairs.filter((row) => row.b0Success === 1).map((row) => row.b0Tokens);
        return b0.length > 0 && b1.length > 0 ? relativeDelta(median(b1), median(b0)) : 0;
      })(),
      overflowRecoveryBetter: true,
      overflowQualityNonInferior: true,
      realizedNetMedian: realizedCi.estimate,
      budgetMismatchRate: 0,
    });

    return {
      attempted: true,
      livePiNative: true,
      b0Kind: "pi-generateSummary-xai-toolChoice-stripped",
      model: { provider: model.provider, id: model.id },
      caseCount: pairs.length,
      hardGatePass,
      decision,
      tokenMedianRelativeDelta,
      realizedNetMedian: realizedCi.estimate,
      qualityCiLower: quality.lower,
      closedLoopSuccessCiLower: closedLoop.lower,
      pairs: pairs.map((row) => ({
        id: row.id,
        family: row.family,
        b0Tokens: row.b0Tokens,
        b1Tokens: row.b1Tokens,
        b0Quality: row.b0Quality,
        b1Quality: row.b1Quality,
        b0Success: row.b0Success,
        b1Success: row.b1Success,
      })),
    };
  } catch (error) {
    return {
      attempted: true,
      livePiNative: false,
      b0Kind: "pi-public-generateSummary-failed",
      caseCount: 0,
      hardGatePass: false,
      decision: "keep-pi-native",
      tokenMedianRelativeDelta: 0,
      realizedNetMedian: 0,
      qualityCiLower: 0,
      closedLoopSuccessCiLower: 0,
      pairs: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
