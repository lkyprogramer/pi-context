import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { createGateEngine, GateEngineError, type RunBundle } from "./engine.js";

const { values } = parseArgs({
  options: {
    workspace: { type: "string" },
    out: { type: "string" },
    bundle: { type: "string" },
  },
  strict: true,
  allowPositionals: false,
});

if (!values.workspace || !values.out || !values.bundle) {
  process.stderr.write("usage: run-gate --workspace <id> --out <dir> --bundle <json>\n");
  process.exit(1);
}

const bundle = JSON.parse(values.bundle) as RunBundle;

try {
  const engine = createGateEngine({
    workspaceId: values.workspace,
    git: {
      async status() {
        return {
          commit: bundle.provenance.commit,
          diffHash: bundle.provenance.diffHash,
          dirty: bundle.provenance.dirty,
        };
      },
    },
    files: {
      mkdir: (path) => mkdir(resolve(path), { recursive: true }).then(() => undefined),
      writeFile: (path, bytes) => writeFile(resolve(path), bytes),
    },
  });
  const digest = await engine.writeImmutableBundle(bundle, resolve(values.out));
  process.stdout.write(`${digest}\n`);
} catch (error) {
  const code = error instanceof GateEngineError ? error.code : "PCR_GATE_INPUT_INVALID";
  process.stderr.write(`${code}\n`);
  process.exit(1);
}
