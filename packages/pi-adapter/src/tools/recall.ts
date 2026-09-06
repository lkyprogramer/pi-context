import { byteOffsetToUtf16Index, sliceUtf8Page, utf16IndexToByteOffset, Utf8PageError } from "@pcr/core";
import { objectParameters, type RuntimeTool, type ToolsRuntime } from "./status.js";
import { createRetrievalTools, resolveRetrievalInput } from "./search.js";

import { pageByteBudget, pageBudgetExceeded, requireOffset } from "./page-budget.js";

const EVIDENCE_ID = /^ev_[a-f0-9]{8,}$/;

export function createRecallTool(runtime: ToolsRuntime): RuntimeTool {
  return {
    name: "context_recall",
    label: "Context Recall",
    description: "Read a bounded exact evidence page by evidenceId. start/end are UTF-16 character offsets, not UTF-8 byte offsets. Converted internally via utf16IndexToByteOffset before paging.",
    parameters: objectParameters(
      {
        evidenceId: { type: "string", description: "Evidence id ev_[hex]" },
        maxTokens: { type: "number", description: "Optional token cap" },
        start: { type: "number", description: "Optional UTF-16 character start offset (not UTF-8 bytes)" },
        end: { type: "number", description: "Optional exclusive UTF-16 character end offset (not UTF-8 bytes)" },
      },
      ["evidenceId"],
    ),
    async execute(_callId, args, signal, _b, ctx) {
      const evidenceId = String(args.evidenceId ?? "");
      if (!EVIDENCE_ID.test(evidenceId)) throw Object.assign(new Error("invalid evidenceId"), { code: "PCR_INVALID_ID" });
      if (signal !== undefined && !(signal instanceof AbortSignal)) {
        throw Object.assign(new Error("invalid signal"), { code: "PCR_RETRIEVAL_INPUT_INVALID" });
      }
      signal?.throwIfAborted();
      if (args.start != null && args.end != null && args.end < args.start) {
        throw Object.assign(new Error("invalid range"), { code: "PCR_INVALID_RANGE" });
      }
      const bound = await resolveRetrievalInput(runtime, ctx);
      if (ctx?.workspaceId && ctx.workspaceId !== bound.cursor.workspaceId) {
        throw Object.assign(new Error("scope denied"), { code: "PCR_RETRIEVAL_SCOPE_DENIED" });
      }
      const startChars = requireOffset(args.start, 0);
      const budget = Math.min(2047, pageByteBudget(ctx, args.maxTokens ?? 256, startChars));
      const page = await createRetrievalTools(bound).read({ evidenceId, ...(signal instanceof AbortSignal ? { signal } : {}) });
      signal?.throwIfAborted();
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(page.bytes);
      } catch {
        throw Object.assign(new Error("binary evidence requires context_read"), { code: "PCR_INVALID_RANGE" });
      }
      const targetEndChars = requireOffset(args.end, text.length);
      if (startChars > targetEndChars || targetEndChars > text.length) throw Object.assign(new Error("invalid range"), { code: "PCR_INVALID_RANGE" });
      const render = (endChars: number) => text.slice(startChars, endChars) + (endChars < targetEndChars
        ? `\n[More remains; call context_recall with start=${endChars}${args.end === undefined ? "" : ` and end=${targetEndChars}`} (character offsets).]`
        : "");
      let low = startChars;
      let high = Math.min(targetEndChars, startChars + Math.min(budget, 2047));
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (Buffer.byteLength(render(mid), "utf8") <= budget) low = mid;
        else high = mid - 1;
      }
      if (low < targetEndChars && low > startChars && /[\uD800-\uDBFF]/u.test(text[low - 1]!)) low--;
      const startBytes = utf16IndexToByteOffset(text, startChars);
      const chosenBytes = utf16IndexToByteOffset(text, low);
      try {
        const sliced = sliceUtf8Page({
          bytes: page.bytes,
          byteOffset: startBytes,
          maxBytes: Math.max(0, chosenBytes - startBytes),
        });
        low = byteOffsetToUtf16Index(text, sliced.nextByteOffset);
      } catch (error) {
        if (error instanceof Utf8PageError) {
          throw Object.assign(new Error("INVALID_BYTE_OFFSET"), { code: "INVALID_BYTE_OFFSET" });
        }
        throw error;
      }
      const sliced = render(low);
      if ((low === startChars && startChars < targetEndChars) || Buffer.byteLength(sliced, "utf8") > budget) {
        pageBudgetExceeded(startChars);
      }
      return { content: [{ type: "text", text: sliced }] };
    },
  };
}
