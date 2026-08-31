import { objectParameters, type RuntimeTool, type RuntimeToolCtx, type ToolsRuntime } from "./status.js";
import {
  RetrievalToolsError,
  createRetrievalTools,
  resolveRetrievalInput,
  type CreateRetrievalToolsInput,
  type ReadToolInput,
} from "./search.js";

const EVIDENCE_ID = /^ev_[a-f0-9]{8,}$/;

export function createReadTool(input: CreateRetrievalToolsInput | ToolsRuntime): RuntimeTool {
  return {
    name: "context_read",
    label: "Context Read",
    description: "Exact byte-range read of scoped evidence with SHA-256 verification.",
    parameters: objectParameters(
      {
        evidenceId: { type: "string", description: "Evidence id ev_[hex]" },
        start: { type: "number", description: "Inclusive byte offset" },
        endExclusive: { type: "number", description: "Exclusive byte offset" },
      },
      ["evidenceId"],
    ),
    async execute(_callId, args, _a, _b, ctx: RuntimeToolCtx | undefined) {
      const bound = await resolveRetrievalInput(input, ctx);
      const evidenceId = String(args.evidenceId ?? "");
      if (!EVIDENCE_ID.test(evidenceId)) {
        throw Object.assign(new Error("invalid evidenceId"), { code: "PCR_INVALID_ID" });
      }
      if (ctx?.workspaceId && ctx.workspaceId !== bound.cursor.workspaceId) {
        throw new RetrievalToolsError("PCR_RETRIEVAL_SCOPE_DENIED");
      }
      if (args.start != null && args.endExclusive != null && args.endExclusive < args.start) {
        throw Object.assign(new Error("invalid range"), { code: "PCR_INVALID_RANGE" });
      }
      const request: ReadToolInput = { evidenceId };
      if (args.start != null || args.endExclusive != null) {
        request.range = {
          start: args.start ?? 0,
          endExclusive: args.endExclusive ?? Number.NaN,
        };
        if (!Number.isSafeInteger(request.range.endExclusive)) {
          throw Object.assign(new Error("invalid range"), { code: "PCR_INVALID_RANGE" });
        }
      }
      const page = await createRetrievalTools(bound).read(request);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            evidenceId: page.evidenceId,
            byteLength: page.byteLength,
            sha256: page.sha256,
            verified: page.verified,
            range: page.range,
            text: Buffer.from(page.bytes).toString("utf8"),
          }),
        }],
      };
    },
  };
}
