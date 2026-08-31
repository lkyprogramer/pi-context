import { spawn, spawnSync, type SpawnOptions, type SpawnSyncOptions } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function nodeTypeScriptArgs(script: string, args: string[] = []): string[] {
  return ["--import", "jiti/register", script, ...args];
}

export function spawnTypeScriptChild(script: string, args: string[] = [], options: SpawnOptions = {}) {
  return spawn(process.execPath, nodeTypeScriptArgs(script, args), {
    ...options,
    env: { ...process.env, ...(options.env as NodeJS.ProcessEnv | undefined) },
  });
}

export function spawnTypeScriptChildSync(script: string, args: string[] = [], options: SpawnSyncOptions = {}) {
  return spawnSync(process.execPath, nodeTypeScriptArgs(script, args), {
    ...options,
    env: { ...process.env, ...(options.env as NodeJS.ProcessEnv | undefined) },
  });
}

export function writeReadyFile(path: string): void {
  writeFileSync(path, "ready");
}

export function crashedWithKill(result: { signal: NodeJS.Signals | null; status: number | null }): boolean {
  return result.signal === "SIGKILL" || result.status === 137 || result.status === 9;
}

export function childScriptPath(root: string, name: string): string {
  return join(root, name);
}
