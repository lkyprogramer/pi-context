import { sliceUtf8Page, Utf8PageError } from "@pcr/core";
import { objectParameters, type RuntimeTool, type RuntimeToolCtx, type ToolsRuntime } from "./status.js";
import { pageByteBudget, pageBudgetExceeded, requireOffset } from "./page-budget.js";
import {
  RetrievalToolsError,
  createRetrievalTools,
  resolveRetrievalInput,
  type CreateRetrievalToolsInput,
} from "./search.js";

const EVIDENCE_ID = /^ev_[a-f0-9]{8,}$/;

function requireByteOffset(args: { start?: number; byteOffset?: number }): number {
  if (args.byteOffset !== undefined && args.start !== undefined && args.byteOffset !== args.start) {
    throw Object.assign(new Error("start is a UTF-8 byte offset; do not mix it with a different byteOffset"), {
      code: "PCR_INVALID_RANGE",
    });
  }
  return requireOffset(args.byteOffset ?? args.start, 0);
}

function decodeUtf8OrNull(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function createReadTool(input: CreateRetrievalToolsInput | ToolsRuntime): RuntimeTool {
  return {
    name: "context_read",
    label: "Context Read",
    description: "Read a budgeted UTF-8 evidence page with original SHA-256 verification. start/byteOffset are UTF-8 bytes, not UTF-16 indexes. Continue with nextOffset as start.",
    parameters: objectParameters(
      {
        evidenceId: { type: "string", description: "Evidence id ev_[hex]" },
        start: { type: "number", description: "Inclusive UTF-8 byte offset; defaults to zero. Alias of byteOffset." },
        byteOffset: { type: "number", description: "Inclusive UTF-8 byte offset; must not disagree with start" },
        endExclusive: { type: "number", description: "Optional exclusive UTF-8 byte limit" },
        maxBytes: { type: "number", description: "Optional UTF-8 byte cap for the page body before JSON wrapping" },
        maxTokens: { type: "number", description: "Optional response token cap; live headroom may reduce it" },
      },
      ["evidenceId"],
    ),
    async execute(_callId, args, signal, _b, ctx: RuntimeToolCtx | undefined) {
      const evidenceId = String(args.evidenceId ?? "");
      if (!EVIDENCE_ID.test(evidenceId)) throw Object.assign(new Error("invalid evidenceId"), { code: "PCR_INVALID_ID" });
      if (signal !== undefined && !(signal instanceof AbortSignal)) {
        throw Object.assign(new Error("invalid signal"), { code: "PCR_RETRIEVAL_INPUT_INVALID" });
      }
      signal?.throwIfAborted();
      const start = requireByteOffset(args);
      const requestedEnd = args.endExclusive === undefined ? undefined : requireOffset(args.endExclusive, 0);
      if (requestedEnd !== undefined && requestedEnd < start) throw Object.assign(new Error("invalid range"), { code: "PCR_INVALID_RANGE" });
      const maxBytes = args.maxBytes === undefined ? undefined : requireOffset(args.maxBytes, 0);
      const bound = await resolveRetrievalInput(input, ctx);
      if (ctx?.workspaceId && ctx.workspaceId !== bound.cursor.workspaceId) throw new RetrievalToolsError("PCR_RETRIEVAL_SCOPE_DENIED");
      const budget = pageByteBudget(ctx, args.maxTokens, start);
      // Authenticated encryption still verifies the full blob; only the returned page is bounded.
      const page = await createRetrievalTools(bound).read({ evidenceId, ...(signal instanceof AbortSignal ? { signal } : {}) });
      signal?.throwIfAborted();
      const targetEnd = requestedEnd ?? page.byteLength;
      if (targetEnd > page.byteLength || start > targetEnd) throw Object.assign(new Error("invalid range"), { code: "PCR_INVALID_RANGE" });
      const text = decodeUtf8OrNull(page.bytes);
      if (text === null) {
        const end = Math.min(targetEnd, start + Math.min(budget, maxBytes ?? budget));
        if (end < start) throw Object.assign(new Error("invalid range"), { code: "PCR_INVALID_RANGE" });
        const payload = JSON.stringify({
          evidenceId: page.evidenceId,
          byteLength: page.byteLength,
          sha256: page.sha256,
          verified: page.verified,
          encoding: "binary",
          range: { start, endExclusive: end },
          bytesBase64: Buffer.from(page.bytes.subarray(start, end)).toString("base64"),
          nextOffset: end < targetEnd ? end : null,
          remainingBytes: targetEnd - end,
        });
        if ((end === start && start < targetEnd) || Buffer.byteLength(payload, "utf8") > budget) pageBudgetExceeded(start);
        return { content: [{ type: "text", text: payload }] };
      }
      const serialize = (end: number) => JSON.stringify({
        evidenceId: page.evidenceId,
        byteLength: page.byteLength,
        sha256: page.sha256,
        verified: page.verified,
        range: { start, endExclusive: end },
        text: Buffer.from(page.bytes.subarray(start, end)).toString("utf8"),
        nextOffset: end < targetEnd ? end : null,
        remainingBytes: targetEnd - end,
      });
      const headerFloor = Buffer.byteLength(serialize(start), "utf8");
      if (headerFloor > budget) pageBudgetExceeded(start);
      let maxBody = Math.min(targetEnd - start, budget, maxBytes ?? budget);
      let pageSlice;
      try {
        pageSlice = sliceUtf8Page({ bytes: page.bytes, byteOffset: start, maxBytes: maxBody });
      } catch (error) {
        if (error instanceof Utf8PageError) {
          throw Object.assign(new Error("INVALID_BYTE_OFFSET"), { code: "INVALID_BYTE_OFFSET" });
        }
        throw error;
      }
      while (pageSlice.nextByteOffset > start && Buffer.byteLength(serialize(pageSlice.nextByteOffset), "utf8") > budget) {
        maxBody = Math.max(0, pageSlice.nextByteOffset - start - 1);
        pageSlice = sliceUtf8Page({ bytes: page.bytes, byteOffset: start, maxBytes: maxBody });
      }
      const end = pageSlice.nextByteOffset;
      const serialized = serialize(end);
      if ((end === start && start < targetEnd) || Buffer.byteLength(serialized, "utf8") > budget) pageBudgetExceeded(start);
      return { content: [{ type: "text", text: serialized }] };
    },
  };
}
