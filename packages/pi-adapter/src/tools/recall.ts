import { objectParameters, type RuntimeTool, type ToolsRuntime } from "./status.js";
import { createRetrievalTools, resolveRetrievalInput } from "./search.js";

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
        start: { type: "number", description: "Optional start offset" },
        end: { type: "number", description: "Optional end offset" },
      },
      ["evidenceId"],
    ),
    async execute(_callId, args, _a, _b, ctx) {
      const evidenceId = String(args.evidenceId ?? "");
      if (!EVIDENCE_ID.test(evidenceId)) throw Object.assign(new Error("invalid evidenceId"), { code: "PCR_INVALID_ID" });
      if (args.start != null && args.end != null && args.end < args.start) {
        throw Object.assign(new Error("invalid range"), { code: "PCR_INVALID_RANGE" });
      }
      const bound = await resolveRetrievalInput(runtime, ctx);
      if (ctx?.workspaceId && ctx.workspaceId !== bound.cursor.workspaceId) {
        throw Object.assign(new Error("scope denied"), { code: "PCR_RETRIEVAL_SCOPE_DENIED" });
      }
      const page = await createRetrievalTools(bound).read({ evidenceId });
      const maxChars = Math.min(2047, Math.max(32, (args.maxTokens ?? 256) * 4));
      const text = Buffer.from(page.bytes).toString("utf8");
      const sliced = text.slice(args.start ?? 0, args.end ?? text.length).slice(0, maxChars);
      return {
        content: [{ type: "text", text: sliced }],
      };
    },
  };
}
