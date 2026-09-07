#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync("pnpm", ["vitest", "run", "tests/w2-gate/head-to-head.test.ts"], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
