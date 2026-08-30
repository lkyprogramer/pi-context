import { boundedWindows, detailsRecord, normalizeLines, rawPointer } from "./text.js";
import type { Reducer, ReducerInput, ReducerOutput } from "./types.js";

export function reduceBashLog(text: string, meta: { exitCode?: number; rawBlobId?: string }): ReducerOutput {
  const lines = normalizeLines(text).map((line) => {
    if (/ignore previous|system prompt|<\/?skill>/i.test(line)) return `[data] ${line}`;
    return line;
  });
  const errorIndexes = lines.flatMap((line, index) => (/error:|fatal:|exit code|Traceback/i.test(line) ? [index] : []));
  const selected =
    errorIndexes.length > 0
      ? boundedWindows(lines, errorIndexes, { before: 2, after: 2, maxLines: 40 })
      : lines.slice(-12);
  return {
    visibleText: [
      `[bash-result exit=${meta.exitCode ?? "unknown"}]`,
      ...selected,
      `[raw:${rawPointer(meta.rawBlobId)}]`,
    ].join("\n"),
    facts: [{ kind: "exit-code", value: meta.exitCode ?? null }],
  };
}

export const bashReducer: Reducer = {
  id: "bash",
  supports: (input) => input.toolName === "bash" || input.toolName === "shell",
  async reduce(input: ReducerInput) {
    const details = detailsRecord(input.observation.details);
    const exitCode = typeof details.exitCode === "number" ? details.exitCode : input.observation.isError ? 1 : 0;
    return reduceBashLog(input.text, { exitCode, rawBlobId: input.rawBlobId });
  },
};
