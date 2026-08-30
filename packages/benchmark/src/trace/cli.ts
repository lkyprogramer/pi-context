import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { createTraceCapture } from "./capture.js";
import { TraceCaptureError } from "./errors.js";
import { createFileTraceStore } from "./file-store.js";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    "corpus-id": { type: "string" },
    cluster: { type: "string" },
    workspace: { type: "string" },
    "session-id": { type: "string" },
    session: { type: "string" },
    snapshot: { type: "string" },
    clusters: { type: "string" },
  },
  strict: true,
  allowPositionals: false,
});

const required = ["root", "corpus-id", "cluster", "workspace", "session-id", "session", "snapshot", "clusters"] as const;
for (const key of required) {
  if (!values[key]) {
    process.stderr.write("usage: capture-trace --root <dir> --corpus-id <id> --cluster <id> --workspace <id> --session-id <id> --session <jsonl> --snapshot <json> --clusters <corpus.json>\n");
    process.exit(1);
  }
}

try {
  const manifest = JSON.parse(await readFile(resolve(values.clusters!), "utf8")) as { clusters?: Record<string, string[]> };
  const snapshot = JSON.parse(await readFile(resolve(values.snapshot!), "utf8")) as unknown;
  const sessionJsonl = await readFile(resolve(values.session!), "utf8");
  const store = createFileTraceStore({ root: resolve(values.root!), corpusId: values["corpus-id"]! });
  const capture = createTraceCapture({
    corpusId: values["corpus-id"]!,
    clusters: manifest.clusters ?? {},
    store,
  });
  const trace = await capture.capture({
    clusterId: values.cluster!,
    workspaceId: values.workspace!,
    sessionId: values["session-id"]!,
    sessionJsonl,
    workspaceSnapshot: snapshot,
  });
  process.stdout.write(`${JSON.stringify(trace, null, 2)}\n`);
} catch (error) {
  if (error instanceof TraceCaptureError) {
    process.stderr.write(`${error.code}\n`);
    process.exit(1);
  }
  throw error;
}
