#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync("python3", ["scripts/findingctl.py", "verify-all"], {
  encoding: "utf8",
  cwd: new URL("../..", import.meta.url).pathname,
});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
