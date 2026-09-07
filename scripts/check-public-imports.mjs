#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../dist", import.meta.url).pathname;
const forbidden = [
  /@earendil-works\/pi-coding-agent\/(?:src|dist\/core)\//,
  /PCR_INGRESS_METADATA_CONTRACT/,
  /patchedDependencies/,
];

function walk(dir, acc = []) {
  if (!statSync(dir, { throwIfNoEntry: false })) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith(".js")) acc.push(p);
  }
  return acc;
}

const files = walk(root);
let failed = false;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const re of forbidden) {
    if (re.test(text)) {
      console.error(`forbidden pattern ${re} in ${file}`);
      failed = true;
    }
  }
}
if (files.some((f) => f.includes("testing.js"))) {
  console.error("testing.js must not ship in dist");
  failed = true;
}
if (failed) process.exit(1);
console.log(JSON.stringify({ ok: true, files: files.length }));
