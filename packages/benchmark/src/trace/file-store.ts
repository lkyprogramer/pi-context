import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { failInput, failMissing } from "./errors.js";
import type { CapturedTrace, CreateFileTraceStoreInput, TraceArtifacts, TraceCaptureStore } from "./types.js";

export function createFileTraceStore(input: CreateFileTraceStoreInput): TraceCaptureStore {
  if (!input || typeof input !== "object") failMissing("input");
  if (typeof input.root !== "string" || input.root.length === 0) failMissing("root");
  if (typeof input.corpusId !== "string" || input.corpusId.length === 0) failMissing("corpusId");
  const root = input.root;
  return {
    async write(trace: CapturedTrace, artifacts: TraceArtifacts): Promise<void> {
      if (!trace || typeof trace !== "object") failInput("trace");
      if (!artifacts || typeof artifacts !== "object") failInput("artifacts");
      await mkdir(root, { recursive: true });
      const files: Array<[string, string]> = [
        ["trace.json", `${JSON.stringify(trace, null, 2)}\n`],
        ["session.redacted.jsonl", artifacts.sessionJsonl],
        ["workspace.redacted.json", `${JSON.stringify(artifacts.workspaceSnapshot, null, 2)}\n`],
        ["redaction.json", `${JSON.stringify(artifacts.redactionReport, null, 2)}\n`],
      ];
      for (const [name, body] of files) {
        const target = join(root, name);
        const tmp = `${target}.${process.pid}.tmp`;
        await writeFile(tmp, body);
        await rename(tmp, target);
      }
    },
  };
}
