#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (!value?.startsWith("--")) continue;
  args.set(value.slice(2), process.argv[index + 1]);
  index += 1;
}

const pid = Number(args.get("pid"));
const progressPath = resolve(args.get("progress") ?? "artifacts/runs/w2-live-native/gate/progress.json");
const statusPath = resolve(args.get("status") ?? "artifacts/runs/w2-live-native/gate/monitor.json");
const intervalMs = Math.max(5_000, Number(args.get("interval-ms") ?? 60_000));
const stallMs = Math.max(intervalMs, Number(args.get("stall-ms") ?? 300_000));
if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("--pid must be a positive process id");

function processAlive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function notify(title, message) {
  if (process.platform !== "darwin") return;
  try {
    execFileSync("osascript", ["-e", `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`], { stdio: "ignore" });
  } catch {
    // Desktop notifications are best effort; JSON status remains authoritative.
  }
}

let previous = null;
let notified = null;
function sample() {
  const now = Date.now();
  let progress = null;
  if (existsSync(progressPath)) {
    try { progress = JSON.parse(readFileSync(progressPath, "utf8")); } catch { progress = null; }
  }
  const completedPairs = Number(progress?.completedPairs ?? 0);
  const expectedPairs = Number(progress?.expectedPairs ?? 0);
  const changed = previous === null || completedPairs !== previous.completedPairs || progress?.lastPair !== previous.lastPair;
  const lastChangeAt = changed ? now : previous.lastChangeAt;
  const alive = processAlive(pid);
  const done = expectedPairs > 0 && completedPairs >= expectedPairs;
  const stalled = alive && !done && now - lastChangeAt >= stallMs;
  const state = done ? "completed" : !alive ? "stopped" : stalled ? "stalled" : "running";
  const status = {
    observedAt: new Date(now).toISOString(),
    pid,
    state,
    completedPairs,
    expectedPairs,
    lastPair: progress?.lastPair ?? null,
    lastProgressAt: progress?.lastAt ?? null,
    lastChangeAt: new Date(lastChangeAt).toISOString(),
    stallMs,
    progressPath,
  };
  writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);
  if (state !== notified && (state === "completed" || state === "stalled" || state === "stopped")) {
    notify(`W2 live gate ${state}`, `${completedPairs}/${expectedPairs} (${status.lastPair ?? "no pair"})`);
    notified = state;
  }
  previous = { completedPairs, lastPair: progress?.lastPair, lastChangeAt };
  if (state !== "running") return false;
  return true;
}

if (!sample()) process.exit(0);
const timer = setInterval(() => {
  if (!sample()) {
    clearInterval(timer);
    process.exit(0);
  }
}, intervalMs);
process.on("SIGTERM", () => { clearInterval(timer); process.exit(0); });
