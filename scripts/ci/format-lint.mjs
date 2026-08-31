#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const result = spawnSync("git", ["ls-files", "*.ts", "*.mjs", "*.js"], { encoding: "utf8" });
if (result.status !== 0) throw new Error(result.stderr);
const forbidden = [];
for (const file of result.stdout.split("\n").filter(Boolean)) {
  if (file.startsWith("artifacts/") || file.startsWith("docs/")) continue;
  const text = readFileSync(file, "utf8");
  if (file.startsWith("tests/") || file.includes("/test/") || file.startsWith("packages/runtime/test/")) {
    if (/\/var\/folders\/yt\//.test(text) && !file.endsWith("t41.test.ts")) {
      forbidden.push(file);
    }
  }
}
if (forbidden.length > 0) {
  console.error("hardcoded developer temp paths:\n" + forbidden.join("\n"));
  process.exit(1);
}
process.stdout.write("format-lint ok\n");
