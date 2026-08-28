import type { ObservationReducer, ReducerOutput } from "./types.js";

const ANSI = /\u001b\[[0-9;]*m/g;
const MAX_LINE = 240;

export function normalizeLines(text: string): string[] {
  return text
    .replace(ANSI, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => (line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line));
}

export function boundedWindows(
  lines: string[],
  indexes: number[],
  opts: { before: number; after: number; maxLines: number },
): string[] {
  const keep = new Set<number>();
  for (const index of indexes) {
    for (let i = Math.max(0, index - opts.before); i <= Math.min(lines.length - 1, index + opts.after); i += 1) {
      keep.add(i);
    }
  }
  return [...keep]
    .sort((a, b) => a - b)
    .slice(0, opts.maxLines)
    .map((i) => lines[i] ?? "");
}

function rawPointer(blobId?: string): string {
  return blobId ? `ctx://observation/${blobId}` : "ctx://observation/raw";
}

function extractTestFacts(lines: string[], exitCode?: number): unknown[] {
  const failed = lines.filter((line) => /\bFAIL\b|FAILED/i.test(line));
  return [
    { kind: "exit-code", value: exitCode ?? null },
    ...failed.map((line) => ({ kind: "failed-test", value: line })),
  ];
}

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
    visibleText: [`[test-result exit=${meta.exitCode ?? "unknown"}]`, ...selected, `[raw:${rawPointer(meta.rawBlobId)}]`].join(
      "\n",
    ),
    facts: extractTestFacts(lines, meta.exitCode),
  };
}

export const testLogReducer: ObservationReducer = {
  id: "test-log",
  revision: "1",
  matches: (input) => /test|vitest|jest|pytest|gradle|maven/i.test(input.toolName),
  reduce: async (input) => reduceTestLog(input.text ?? "", { exitCode: undefined, rawBlobId: input.rawBlobId }),
};
