export type ToolClass = "query" | "command" | "ambiguous";

const QUERY_TOOLS = new Set(["read", "grep", "find", "ls", "search", "cat", "get", "glob"]);
const COMMAND_TOOLS = new Set([
  "write",
  "edit",
  "bash",
  "deploy",
  "rm",
  "delete",
  "curl",
  "fetch",
  "network",
  "chmod",
  "chown",
  "apply",
]);

export const TOOL_TAXONOMY_VERSION = "1";

export function classifyTool(toolName: string): ToolClass {
  const name = toolName.toLowerCase();
  if (QUERY_TOOLS.has(name)) return "query";
  if (COMMAND_TOOLS.has(name)) return "command";
  return "ambiguous";
}

export function effectiveToolClass(toolName: string): Exclude<ToolClass, "ambiguous"> {
  const classified = classifyTool(toolName);
  return classified === "query" ? "query" : "command";
}

/** Default: custom/MCP/unknown tools are untrusted. Only the query allowlist is trusted-tool. */
export function toolResultSourceClass(toolName: string): "trusted-tool" | "untrusted-tool" {
  return classifyTool(toolName) === "query" ? "trusted-tool" : "untrusted-tool";
}

export function hasEgressArgs(args: unknown): boolean {
  const text = JSON.stringify(args ?? {});
  return /https?:\/\/|localhost|0\.0\.0\.0|webhook/i.test(text);
}
