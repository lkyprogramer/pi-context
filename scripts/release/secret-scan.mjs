#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SECRET = /(?:sk-[A-Za-z0-9][A-Za-z0-9_-]{8,}|sk-(?:live|t\d+|ff)(?:-[A-Za-z0-9_-]+)?|Bearer\s+[A-Za-z0-9._-]{20,})/giu;

function files(root) {
  const out = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...files(path));
    else if (stat.size <= 8 * 1024 * 1024) out.push(path);
  }
  return out;
}

const root = resolve(process.argv[2] ?? "artifacts/runs/rc");
const findings = [];
for (const path of files(root)) {
  const text = readFileSync(path, "utf8");
  if (SECRET.test(text)) findings.push(path);
  SECRET.lastIndex = 0;
}
const report = { root, scanned: files(root).length, findings };
console.log(JSON.stringify(report, null, 2));
if (findings.length) process.exitCode = 1;
