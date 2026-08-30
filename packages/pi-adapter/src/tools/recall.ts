import { objectParameters, type RuntimeTool, type ToolsRuntime } from "./status.js";

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
      const workspaceId = ctx?.workspaceId ?? runtime.workspaceId;
      const record = runtime.recalledEvidence?.[evidenceId];
      if (!record || runtime.evidenceWorkspace?.[evidenceId] !== workspaceId) {
        throw Object.assign(new Error("scope denied"), { code: "PCR_RETRIEVAL_SCOPE_DENIED" });
      }
      if (args.start != null && args.end != null && args.end < args.start) {
        throw Object.assign(new Error("invalid range"), { code: "PCR_INVALID_RANGE" });
      }
      const maxChars = Math.min(2047, Math.max(32, (args.maxTokens ?? 256) * 4));
      const sliced = record.slice(args.start ?? 0, args.end ?? record.length).slice(0, maxChars);
      return {
        content: [{ type: "text", text: sliced }],
      };
    },
  };
}
