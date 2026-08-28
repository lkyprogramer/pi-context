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
  directive?: string;
  approved?: boolean;
}

export interface RuntimeTool {
  name: string;
  execute(
    callId: string,
    args: ToolExecuteArgs,
    _a?: unknown,
    _b?: unknown,
    ctx?: RuntimeToolCtx,
  ): Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

export interface ToolsRuntime {
  workspaceId: string;
  evidence?: Record<string, string>;
  evidenceWorkspace?: Record<string, string>;
  encryptionKey?: string;
  searchIndex?: Array<{ id: string; body: string; workspaceId: string }>;
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
    async execute(_callId, _args, _a, _b, ctx) {
      const payload = {
        workspaceId: ctx?.workspaceId ?? runtime.workspaceId,
        claimed: runtime.claimed === true,
      };
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
  };
}
