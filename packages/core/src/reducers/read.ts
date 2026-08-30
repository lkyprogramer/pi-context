import { detailsRecord, rawPointer } from "./text.js";
import type { Reducer, ReducerInput, ReducerOutput } from "./types.js";

function normalizeWorkspacePath(path: string): string {
  const trimmed = path.replace(/\\/g, "/");
  if (trimmed.includes("..") || trimmed.startsWith("/") || /^[A-Za-z]:/.test(trimmed)) {
    return trimmed.replace(/^(\/|[A-Za-z]:)/, "").replace(/\.\.\//g, "");
  }
  return trimmed;
}

export function reduceReadResult(
  text: string,
  input: { path: string; start?: number; end?: number; truncated?: boolean; rawBlobId?: string },
): ReducerOutput {
  const path = normalizeWorkspacePath(input.path);
  const start = input.start ?? 1;
  const end = input.end ?? start + text.split("\n").length - 1;
  const pointer = input.truncated
    ? `[truncated raw:${rawPointer(input.rawBlobId)}]`
    : `[raw:${rawPointer(input.rawBlobId)}]`;
  return {
    visibleText: [`[read ${path} ${start}-${end}]`, text.slice(0, 4000), pointer].join("\n"),
    facts: [{ kind: "read-range", value: { path, start, end, truncated: input.truncated === true }, authority: "inform" }],
  };
}

export const readReducer: Reducer = {
  id: "read",
  supports: (input) => input.toolName === "read",
  async reduce(input: ReducerInput) {
    const details = detailsRecord(input.observation.details);
    const args = detailsRecord(input.observation.args);
    const path = typeof args.path === "string" ? args.path : typeof details.path === "string" ? details.path : "file";
    return reduceReadResult(input.text, {
      path,
      truncated: input.text.length > 4000,
      rawBlobId: input.rawBlobId,
    });
  },
};
