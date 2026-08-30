import { boundedWindows, detailsRecord, normalizeLines, rawPointer } from "./text.js";
import type { Reducer, ReducerInput, ReducerOutput } from "./types.js";

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
      `[raw:${rawPointer(meta.rawBlobId)}]`,
    ].join("\n"),
    facts: [
      { kind: "exit-code", value: meta.exitCode ?? null },
      ...lines.filter((line) => /error/i.test(line)).map((line) => ({ kind: "build-error", value: line })),
    ],
  };
}

export const buildLogReducer: Reducer = {
  id: "build-log",
  supports: (input) => /build|compile|cargo|mvn|gradle/i.test(input.toolName),
  async reduce(input: ReducerInput) {
    const details = detailsRecord(input.observation.details);
    const exitCode = typeof details.exitCode === "number" ? details.exitCode : undefined;
    return reduceBuildLog(input.text, { exitCode, rawBlobId: input.rawBlobId });
  },
};
