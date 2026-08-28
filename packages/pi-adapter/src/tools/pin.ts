import type { RuntimeTool, ToolsRuntime } from "./status.js";

export function createPinTool(_runtime: ToolsRuntime): RuntimeTool {
  return {
    name: "context_pin",
    async execute(_callId, args, _a, _b, ctx) {
      if (ctx?.channel !== "authenticated-user" || args.approved !== true) {
        throw Object.assign(new Error("pin requires authenticated user confirmation"), { code: "PCR_PIN_DENIED" });
      }
      const directive = String(args.directive ?? "").slice(0, 240);
      if (!directive) throw Object.assign(new Error("directive required"), { code: "PCR_INVALID_ID" });
      return { content: [{ type: "text", text: JSON.stringify({ pinned: true, directive }) }] };
    },
  };
}
