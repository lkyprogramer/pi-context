import type { RuntimeCursor } from "@pcr/contracts";
import type { EvidenceService } from "@pcr/runtime";

export interface RuntimeToolCtx {
  workspaceId?: string;
  sessionId?: string;
  channel?: "authenticated-user" | "untrusted-user" | "agent";
}

export interface ToolExecuteArgs {
  evidenceId?: string;
  maxTokens?: number;
  query?: string;
  limit?: number;
  timeoutMs?: number;
  start?: number;
  end?: number;
  endExclusive?: number;
  directive?: string;
  approved?: boolean;
}

export interface ToolJsonSchema {
  type: "object";
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface RuntimeTool {
  name: string;
  label: string;
  description: string;
  parameters: ToolJsonSchema;
  execute(
    callId: string,
    args: ToolExecuteArgs,
    _a?: unknown,
    _b?: unknown,
    ctx?: RuntimeToolCtx,
  ): Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

export function objectParameters(
  properties: ToolJsonSchema["properties"] = {},
  required: string[] = [],
): ToolJsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

export interface ToolsRuntime {
  workspaceId: string;
  cursor: RuntimeCursor;
  evidence: EvidenceService;
  /**
   * When set, search/read/recall resolve cursor+evidence at execute time
   * instead of snapshotting the registration-time placeholder.
   */
  resolve?(ctx?: RuntimeToolCtx): Promise<{ cursor: RuntimeCursor; evidence: EvidenceService }> | { cursor: RuntimeCursor; evidence: EvidenceService };
  recalledEvidence?: Record<string, string>;
  evidenceWorkspace?: Record<string, string>;
  encryptionKey?: string;
  claimed?: boolean;
  commands?: {
    status(ctx: RuntimeToolCtx): Promise<string> | string;
    doctor(ctx: RuntimeToolCtx): Promise<string> | string;
    compact(ctx: RuntimeToolCtx): Promise<string> | string;
  };
}

export function createStatusTool(runtime: ToolsRuntime): RuntimeTool {
  return {
    name: "context_status",
    label: "Context Status",
    description: "Show Pi Context Runtime claim and workspace status.",
    parameters: objectParameters(),
    async execute(_callId, _args, _a, _b, ctx) {
      const payload = {
        workspaceId: ctx?.workspaceId ?? runtime.workspaceId,
        claimed: runtime.claimed === true,
      };
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
  };
}
