import { objectParameters, type RuntimeTool, type RuntimeToolCtx, type ToolsRuntime } from "./status.js";
import { pageByteBudget, pageBudgetExceeded, requireOffset } from "./page-budget.js";
import {
  RetrievalToolsError,
  createRetrievalTools,
  resolveRetrievalInput,
  type CreateRetrievalToolsInput,
} from "./search.js";

const EVIDENCE_ID = /^ev_[a-f0-9]{8,}$/;

export function createReadTool(input: CreateRetrievalToolsInput | ToolsRuntime): RuntimeTool {
  return {
    name: "context_read",
    label: "Context Read",
    description: "Read a budgeted UTF-8 evidence page with original SHA-256 verification. Continue with nextOffset as start; offsets are bytes.",
    parameters: objectParameters(
      {
        evidenceId: { type: "string", description: "Evidence id ev_[hex]" },
        start: { type: "number", description: "Inclusive byte offset; defaults to zero" },
        endExclusive: { type: "number", description: "Optional exclusive byte limit" },
        maxTokens: { type: "number", description: "Optional response token cap; live headroom may reduce it" },
      },
      ["evidenceId"],
    ),
    async execute(_callId, args, signal, _b, ctx: RuntimeToolCtx | undefined) {
      const evidenceId = String(args.evidenceId ?? "");
      if (!EVIDENCE_ID.test(evidenceId)) throw Object.assign(new Error("invalid evidenceId"), { code: "PCR_INVALID_ID" });
      const start = requireOffset(args.start, 0);
      const requestedEnd = args.endExclusive === undefined ? undefined : requireOffset(args.endExclusive, 0);
      if (requestedEnd !== undefined && requestedEnd < start) throw Object.assign(new Error("invalid range"), { code: "PCR_INVALID_RANGE" });
      const bound = await resolveRetrievalInput(input, ctx);
      if (ctx?.workspaceId && ctx.workspaceId !== bound.cursor.workspaceId) throw new RetrievalToolsError("PCR_RETRIEVAL_SCOPE_DENIED");
      const budget = pageByteBudget(ctx, args.maxTokens, start);
      // Authenticated encryption still verifies the full blob; only the returned page is bounded.
      const page = await createRetrievalTools(bound).read({ evidenceId, ...(signal instanceof AbortSignal ? { signal } : {}) });
      const targetEnd = requestedEnd ?? page.byteLength;
      if (targetEnd > page.byteLength || start > targetEnd) throw Object.assign(new Error("invalid range"), { code: "PCR_INVALID_RANGE" });
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
      // Decoding a partial multibyte character inserts U+FFFD and breaks the
      // monotonic size assumption of byte-wise binary search. Search boundaries.
      const boundaries = [start];
      const maximumEnd = Math.min(targetEnd, start + budget);
      for (let candidate = start + 1; candidate <= maximumEnd; candidate++) {
        if (candidate === targetEnd || (page.bytes[candidate]! & 0xc0) !== 0x80) boundaries.push(candidate);
      }
      let low = 0;
      let high = boundaries.length - 1;
      if (Buffer.byteLength(serialize(boundaries[high]!), "utf8") <= budget) low = high;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (Buffer.byteLength(serialize(boundaries[mid]!), "utf8") <= budget) low = mid;
        else high = mid - 1;
      }
      const end = boundaries[low]!;
      const text = serialize(end);
      if ((end === start && start < targetEnd) || Buffer.byteLength(text, "utf8") > budget) pageBudgetExceeded(start);
      return { content: [{ type: "text", text }] };
    },
  };
}
