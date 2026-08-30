import { createPinTool } from "../tools/pin.js";
import { createReadTool } from "../tools/read.js";
import { createRecallTool } from "../tools/recall.js";
import { createSearchTool } from "../tools/search.js";
import { createStatusTool, objectParameters, type RuntimeTool, type RuntimeToolCtx, type ToolJsonSchema, type ToolsRuntime } from "../tools/status.js";

export interface ToolingExtensionAPI {
  registerTool(tool: RuntimeTool): void;
  registerCommand(name: string, spec: { description: string; handler: (args: unknown, ctx: RuntimeToolCtx) => Promise<unknown> | unknown }): void;
  hasTool?(name: string): boolean;
}

export type RegisteredRuntimeTools = RuntimeTool[] & {
  context_recall: RuntimeTool;
  context_search: RuntimeTool;
  context_read: RuntimeTool;
  context_status: RuntimeTool;
  context_pin: RuntimeTool;
};

export function createRegisteredRuntimeTools(runtime: ToolsRuntime): RegisteredRuntimeTools {
  const context_recall = createRecallTool(runtime);
  const context_search = createSearchTool(runtime);
  const context_read = createReadTool(runtime);
  const context_status = createStatusTool(runtime);
  const context_pin = createPinTool(runtime);
  return Object.assign([context_recall, context_search, context_read, context_status, context_pin], {
    context_recall,
    context_search,
    context_read,
    context_status,
    context_pin,
  });
}

export function registerRuntimeTools(pi: ToolingExtensionAPI, runtime: ToolsRuntime): void {
  const tools = createRegisteredRuntimeTools(runtime);
  for (const tool of tools) {
    if (pi.hasTool?.(tool.name)) throw new Error(`tool name collision: ${tool.name}`);
    pi.registerTool(tool);
  }
  const commands = runtime.commands ?? {
    status: (ctx: RuntimeToolCtx) => JSON.stringify({ ok: true, command: "context", workspaceId: ctx.workspaceId ?? runtime.workspaceId }),
    doctor: (ctx: RuntimeToolCtx) => JSON.stringify({ ok: true, command: "context-doctor", workspaceId: ctx.workspaceId ?? runtime.workspaceId }),
    compact: (ctx: RuntimeToolCtx) => JSON.stringify({ ok: true, command: "context-compact", workspaceId: ctx.workspaceId ?? runtime.workspaceId }),
  };
  pi.registerCommand("context", { description: "Show Pi Context Runtime status", handler: (_args, ctx) => commands.status(ctx) });
  pi.registerCommand("context-doctor", { description: "Run capability and storage diagnostics", handler: (_args, ctx) => commands.doctor(ctx) });
  pi.registerCommand("context-compact", { description: "Request settled host convergence", handler: (_args, ctx) => commands.compact(ctx) });
}

export { createRecallTool, createSearchTool, createReadTool, createStatusTool, createPinTool, objectParameters };
export type { RuntimeTool, RuntimeToolCtx, ToolsRuntime, ToolJsonSchema };
