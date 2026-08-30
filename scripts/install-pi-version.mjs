#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = join(root, "compat/pi.lock.json");

export const PINNED_PI_VERSION = "0.84.4";
export const BASELINE_COMMIT = "938109e7259068ff736dbba3bed14c81af25abbe";

export function readCompatLock() {
  return JSON.parse(readFileSync(lockPath, "utf8"));
}

export function writeCompatLock(lock) {
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  return lock;
}

export function installCommand(version = PINNED_PI_VERSION) {
  if (version === PINNED_PI_VERSION) return "pnpm install --frozen-lockfile";
  return `npm install -g @earendil-works/pi-coding-agent@${version}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const version = process.argv[2] ?? PINNED_PI_VERSION;
  const lock = readCompatLock();
  if (!lock.tested.includes(version)) lock.tested.push(version);
  writeCompatLock(lock);
  console.log(JSON.stringify({ version, command: installCommand(version), lock }, null, 2));
}
