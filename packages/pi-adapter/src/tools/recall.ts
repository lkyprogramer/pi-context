import { objectParameters, type RuntimeTool, type ToolsRuntime } from "./status.js";
import { createRetrievalTools, resolveRetrievalInput } from "./search.js";

import { pageByteBudget, pageBudgetExceeded, requireOffset } from "./page-budget.js";

const EVIDENCE_ID = /^ev_[a-f0-9]{8,}$/;

export function createRecallTool(runtime: ToolsRuntime): RuntimeTool {
  return {
    name: "context_recall",
    label: "Context Recall",
    description: "Read a bounded exact evidence page by evidenceId.",
    parameters: objectParameters(
      {
        evidenceId: { type: "string", description: "Evidence id ev_[hex]" },
        maxTokens: { type: "number", description: "Optional token cap" },
        start: { type: "number", description: "Optional UTF-16 character start offset" },
        end: { type: "number", description: "Optional exclusive UTF-16 character end offset" },
      },
      ["evidenceId"],
    ),
    async execute(_callId, args, signal, _b, ctx) {
      const evidenceId = String(args.evidenceId ?? "");
      if (!EVIDENCE_ID.test(evidenceId)) throw Object.assign(new Error("invalid evidenceId"), { code: "PCR_INVALID_ID" });
      if (args.start != null && args.end != null && args.end < args.start) {
        throw Object.assign(new Error("invalid range"), { code: "PCR_INVALID_RANGE" });
      }
      const bound = await resolveRetrievalInput(runtime, ctx);
      if (ctx?.workspaceId && ctx.workspaceId !== bound.cursor.workspaceId) {
        throw Object.assign(new Error("scope denied"), { code: "PCR_RETRIEVAL_SCOPE_DENIED" });
      }
      const start = requireOffset(args.start, 0);
      const budget = Math.min(2047, pageByteBudget(ctx, args.maxTokens ?? 256, start));
      const page = await createRetrievalTools(bound).read({ evidenceId, ...(signal instanceof AbortSignal ? { signal } : {}) });
      const text = Buffer.from(page.bytes).toString("utf8");
      const targetEnd = requireOffset(args.end, text.length);
      if (start > targetEnd || targetEnd > text.length) throw Object.assign(new Error("invalid range"), { code: "PCR_INVALID_RANGE" });
      const render = (end: number) => text.slice(start, end) + (end < targetEnd
        ? `\n[More remains; call context_recall with start=${end}${args.end === undefined ? "" : ` and end=${targetEnd}`} (character offsets).]`
        : "");
      let low = start;
      let high = Math.min(targetEnd, start + Math.min(budget, 2047));
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (Buffer.byteLength(render(mid), "utf8") <= budget) low = mid;
        else high = mid - 1;
      }
      if (low < targetEnd && low > start && /[\uD800-\uDBFF]/u.test(text[low - 1]!)) low--;
      const sliced = render(low);
      if ((low === start && start < targetEnd) || Buffer.byteLength(sliced, "utf8") > budget) pageBudgetExceeded(start);
      return { content: [{ type: "text", text: sliced }] };
    },
  };
}
