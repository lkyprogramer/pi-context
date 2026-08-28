import type { ObservationReducer, ReducerOutput } from "./types.js";

export function reduceMutationResult(
  text: string,
  input: { toolName: "edit" | "write" | "ls"; path?: string; ok?: boolean },
): ReducerOutput {
  const failed = input.ok === false || /error|failed|rejected/i.test(text);
  const path = (input.path ?? "unknown").replace(/\.\.\//g, "");
  if (input.toolName === "ls") {
    const entries = text.split("\n").filter(Boolean).slice(0, 80);
    return {
      visibleText: [`[ls ${path}]`, ...entries, "[raw:ctx://observation/raw]"].join("\n"),
      facts: entries.map((entry) => ({ kind: "dir-entry", value: { path, entry }, authority: "inform" })),
    };
  }
  if (failed) {
    return {
      visibleText: [`[${input.toolName} failed ${path}]`, text.slice(0, 500), "[raw:ctx://observation/raw]"].join("\n"),
      facts: [{ kind: "mutation-failed", value: { path, toolName: input.toolName }, authority: "inform" }],
    };
  }
  return {
    visibleText: [`[${input.toolName} ok ${path}]`, "[raw:ctx://observation/raw]"].join("\n"),
    facts: [{ kind: "mutation", value: { path, toolName: input.toolName }, authority: "inform" }],
  };
}

export const fileMutationReducer: ObservationReducer = {
  id: "file-mutation",
  revision: "1",
  matches: (input) => /edit|write|ls/i.test(input.toolName),
  reduce: async (input) =>
    reduceMutationResult(input.text ?? "", { toolName: input.toolName as "edit" | "write" | "ls" }),
};
