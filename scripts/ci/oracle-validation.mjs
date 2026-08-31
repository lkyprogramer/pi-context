#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const root = new URL("../..", import.meta.url).pathname;
const lockPath = join(root, "tests/w1-gate/corpus.lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
if (lock.major !== 1 || typeof lock.sha256 !== "string" || lock.sha256.length !== 64) {
  throw new Error("w1 corpus lock is invalid");
}
const digest = createHash("sha256").update(readFileSync(lockPath)).digest("hex");
process.stdout.write(`${JSON.stringify({ ok: true, lockPath: "tests/w1-gate/corpus.lock.json", fileDigest: digest }, null, 2)}\n`);
