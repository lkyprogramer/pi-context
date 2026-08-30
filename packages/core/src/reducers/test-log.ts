import { boundedWindows, detailsRecord, normalizeLines, rawPointer } from "./text.js";
import type { Reducer, ReducerInput, ReducerOutput } from "./types.js";

export function reduceTestLog(text: string, meta: { exitCode?: number; rawBlobId?: string }): ReducerOutput {
  const lines = normalizeLines(text);
  const failureIndexes = lines.flatMap((line, index) =>
    /FAIL|FAILED|Error:|expected.*received/i.test(line) ? [index] : [],
  );
  const selected =
    failureIndexes.length > 0
      ? boundedWindows(lines, failureIndexes, { before: 2, after: 4, maxLines: 120 }).filter((line) => !/^PASS\b/.test(line))
      : lines.filter((line) => /Tests:|\b\d+ passed\b|\b\d+ failed\b/i.test(line)).slice(0, 8);
  return {
    visibleText: [`[test-result exit=${meta.exitCode ?? "unknown"}]`, ...selected, `[raw:${rawPointer(meta.rawBlobId)}]`].join("\n"),
    facts: [
      { kind: "exit-code", value: meta.exitCode ?? null },
      ...lines.filter((line) => /\bFAIL\b|FAILED/i.test(line)).map((line) => ({ kind: "failed-test", value: line })),
    ],
  };
}

export const testLogReducer: Reducer = {
  id: "test-log",
  supports: (input) => /test|vitest|jest|mocha/i.test(input.toolName),
  async reduce(input: ReducerInput) {
    const details = detailsRecord(input.observation.details);
    const exitCode = typeof details.exitCode === "number" ? details.exitCode : undefined;
    return reduceTestLog(input.text, { exitCode, rawBlobId: input.rawBlobId });
  },
};
