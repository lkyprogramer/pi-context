import type { ObservationReducer, ReducerOutput } from "./types.js";

function normalizeWorkspacePath(path: string): string {
  const trimmed = path.replace(/\\/g, "/");
  if (trimmed.includes("..") || trimmed.startsWith("/") || /^[A-Za-z]:/.test(trimmed)) {
    return trimmed.replace(/^(\/|[A-Za-z]:)/, "").replace(/\.\.\//g, "");
  }
  return trimmed;
}

export function reduceReadResult(
  text: string,
  input: { path: string; start?: number; end?: number; truncated?: boolean },
): ReducerOutput {
  const path = normalizeWorkspacePath(input.path);
  const start = input.start ?? 1;
  const end = input.end ?? start + text.split("\n").length - 1;
  const pointer = input.truncated ? `[truncated raw:ctx://observation/${path}]` : `[raw:ctx://observation/${path}]`;
  return {
    visibleText: [`[read ${path} ${start}-${end}]`, text.slice(0, 4000), pointer].join("\n"),
    facts: [{ kind: "read-range", value: { path, start, end, truncated: input.truncated === true }, authority: "inform" }],
  };
}

export const readReducer: ObservationReducer = {
  id: "read",
  revision: "1",
  matches: (input) => input.toolName === "read",
  reduce: async (input) => reduceReadResult(input.text ?? "", { path: "file", truncated: (input.bytes ?? 0) > 4000 }),
};
