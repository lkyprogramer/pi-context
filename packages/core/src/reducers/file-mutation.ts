import { detailsRecord, rawPointer } from "./text.js";
import type { Reducer, ReducerInput, ReducerOutput } from "./types.js";

export function reduceMutationResult(
  text: string,
  input: { toolName: "edit" | "write" | "ls"; path?: string; ok?: boolean; rawBlobId?: string },
): ReducerOutput {
  const failed = input.ok === false || /error|failed|rejected/i.test(text);
  const path = (input.path ?? "unknown").replace(/\.\.\//g, "");
  if (input.toolName === "ls") {
    const entries = text.split("\n").filter(Boolean).slice(0, 80);
    return {
      visibleText: [`[ls ${path}]`, ...entries, `[raw:${rawPointer(input.rawBlobId)}]`].join("\n"),
      facts: entries.map((entry) => ({ kind: "dir-entry", value: { path, entry }, authority: "inform" })),
    };
  }
  if (failed) {
    return {
      visibleText: [`[${input.toolName} failed ${path}]`, text.slice(0, 500), `[raw:${rawPointer(input.rawBlobId)}]`].join("\n"),
      facts: [{ kind: "mutation-failed", value: { path, toolName: input.toolName }, authority: "inform" }],
    };
  }
  return {
    visibleText: [`[${input.toolName} ok ${path}]`, `[raw:${rawPointer(input.rawBlobId)}]`].join("\n"),
    facts: [{ kind: "mutation", value: { path, toolName: input.toolName }, authority: "inform" }],
  };
}

export const fileMutationReducer: Reducer = {
  id: "file-mutation",
  supports: (input) => /^(edit|write|ls)$/i.test(input.toolName),
  async reduce(input: ReducerInput) {
    const args = detailsRecord(input.observation.args);
    const path = typeof args.path === "string" ? args.path : undefined;
    const toolName = input.observation.toolName.toLowerCase() as "edit" | "write" | "ls";
    return reduceMutationResult(input.text, {
      toolName,
      path,
      ok: input.observation.isError !== true,
      rawBlobId: input.rawBlobId,
    });
  },
};
