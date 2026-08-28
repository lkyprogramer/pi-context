import type { ObservationReducer, ReducerOutput } from "./types.js";
import { normalizeLines } from "./test-log.js";

export function reduceBashLog(text: string, meta: { exitCode?: number; rawBlobId?: string }): ReducerOutput {
  const lines = normalizeLines(text).map((line) => {
    if (/ignore previous|system prompt|<\/?skill>/i.test(line)) return `[data] ${line}`;
    return line;
  });
  const errorIndexes = lines.flatMap((line, index) => (/error:|fatal:|exit code|Traceback/i.test(line) ? [index] : []));
  const selected =
    errorIndexes.length > 0
      ? lines.filter((_, index) => errorIndexes.some((hit) => Math.abs(hit - index) <= 2)).slice(0, 40)
      : lines.slice(-12);
  return {
    visibleText: [
      `[bash-result exit=${meta.exitCode ?? "unknown"}]`,
      ...selected,
      `[raw:ctx://observation/${meta.rawBlobId ?? "raw"}]`,
    ].join("\n"),
    facts: [{ kind: "exit-code", value: meta.exitCode ?? null }],
  };
}

export const bashReducer: ObservationReducer = {
  id: "bash",
  revision: "1",
  matches: (input) => input.toolName === "bash" || input.toolName === "shell",
  reduce: async (input) => reduceBashLog(input.text ?? "", { rawBlobId: input.rawBlobId }),
};
