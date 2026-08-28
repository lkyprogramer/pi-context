import type { RuntimeTool, ToolsRuntime } from "./status.js";

export function createSearchTool(runtime: ToolsRuntime): RuntimeTool {
  return {
    name: "context_search",
    async execute(_callId, args, _a, _b, ctx) {
      const query = String(args.query ?? "");
      if (!query || /select\s|drop\s|\/.+\/[gimsuy]*/i.test(query)) {
        throw Object.assign(new Error("unsafe query"), { code: "PCR_SEARCH_UNSAFE" });
      }
      const limit = Math.min(20, Math.max(1, args.limit ?? 5));
      const timeoutMs = Math.min(250, Math.max(10, args.timeoutMs ?? 80));
      const started = Date.now();
      const workspaceId = ctx?.workspaceId ?? runtime.workspaceId;
      const hits = [];
      for (const item of runtime.searchIndex ?? []) {
        if (Date.now() - started > timeoutMs) break;
        if (item.workspaceId !== workspaceId) continue;
        if (!item.body.toLowerCase().includes(query.toLowerCase())) continue;
        hits.push({ id: item.id, snippet: item.body.slice(0, 160) });
        if (hits.length >= limit) break;
      }
      return { content: [{ type: "text", text: JSON.stringify({ hits, limit, timeoutMs }) }] };
    },
  };
}
