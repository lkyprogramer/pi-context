#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync("pnpm", ["vitest", "run", "tests/live-gate/verification.test.ts"], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
