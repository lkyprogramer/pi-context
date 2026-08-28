import type { ObservationReducer, ReducerOutput } from "./types.js";
import { boundedWindows, normalizeLines } from "./test-log.js";

export function reduceBuildLog(text: string, meta: { exitCode?: number; rawBlobId?: string }): ReducerOutput {
  const lines = normalizeLines(text);
  const errorIndexes = lines.flatMap((line, index) =>
    /error[:\]]|FAILED|BUILD FAILURE|error\[/i.test(line) ? [index] : [],
  );
  const selected =
    errorIndexes.length > 0
      ? boundedWindows(lines, errorIndexes, { before: 1, after: 2, maxLines: 80 })
      : lines.filter((line) => /Finished|BUILD SUCCESS|compiled/i.test(line)).slice(0, 6);
  return {
    visibleText: [
      `[build-result exit=${meta.exitCode ?? "unknown"}]`,
      ...selected,
      `[raw:ctx://observation/${meta.rawBlobId ?? "raw"}]`,
    ].join("\n"),
    facts: [
      { kind: "exit-code", value: meta.exitCode ?? null },
      ...lines.filter((line) => /error/i.test(line)).map((line) => ({ kind: "build-error", value: line })),
    ],
  };
}

export const buildLogReducer: ObservationReducer = {
  id: "build-log",
  revision: "1",
  matches: (input) => /build|compile|cargo|mvn|gradle/i.test(input.toolName),
  reduce: async (input) => reduceBuildLog(input.text ?? "", { rawBlobId: input.rawBlobId }),
};
