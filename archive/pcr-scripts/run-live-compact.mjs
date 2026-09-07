#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vitest = join(root, "node_modules/.bin/vitest");
const result = spawnSync(vitest, ["run", "--workspace", "vitest.live-compact.workspace.ts"], {
  stdio: "inherit",
  cwd: root,
});
process.exit(result.status ?? 1);
