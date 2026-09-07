import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePiBin } from "./pi-resolve.js";

export interface InstallLayer {
  nodeVersion: string;
  piVersion: string;
  listBefore: string;
  listAfter: string;
  localInstall: { ok: boolean; stdout: string; stderr: string };
  smoke: {
    ok: boolean;
    stopReason: string | null;
    errorMessage: string | null;
    missingParameters: boolean;
    rawTail: string;
  };
}

function runPi(args: string[], cwd: string, extraEnv: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(resolvePiBin(), args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PI_OFFLINE: "1", ...extraEnv },
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export async function runInstallLayer(repoRoot: string): Promise<InstallLayer> {
  const version = runPi(["--version"], repoRoot);
  const listBefore = runPi(["list", "--approve"], repoRoot);
  const install = runPi(["install", "-l", "./apps/pi-context-runtime", "--approve"], repoRoot);
  const listAfter = runPi(["list", "--approve"], repoRoot);

  const staged = mkdtempSync(join(tmpdir(), "pcr-live-smoke-"));
  mkdirSync(join(staged), { recursive: true });
  const extension = join(repoRoot, "apps/pi-context-runtime/dist/extension.js");
  if (!existsSync(extension)) throw new Error(`missing ${extension}`);
  const smoke = runPi(
    [
      "--no-extensions",
      "-e",
      extension,
      "--no-session",
      "--offline",
      "-p",
      "--mode",
      "json",
      "--no-tools",
      "reply with ok only",
    ],
    staged,
  );
  writeFileSync(join(staged, "smoke.jsonl"), `${smoke.stdout}\n${smoke.stderr}`);
  const combined = `${smoke.stdout}\n${smoke.stderr}`;
  const errorMessage = [...combined.matchAll(/"errorMessage":"([^"]+)"/g)].at(-1)?.[1] ?? null;
  const stopReason = [...combined.matchAll(/"stopReason":"([^"]+)"/g)].at(-1)?.[1] ?? null;
  const missingParameters = /missing field `parameters`/.test(combined);
  const ok = smoke.status === 0 && !missingParameters && stopReason !== "error";

  return {
    nodeVersion: process.versions.node,
    piVersion: version.stdout.trim() || version.stderr.trim(),
    listBefore: listBefore.stdout.trim() || listBefore.stderr.trim(),
    listAfter: listAfter.stdout.trim() || listAfter.stderr.trim(),
    localInstall: {
      ok: install.status === 0,
      stdout: install.stdout.slice(0, 2000),
      stderr: install.stderr.slice(0, 2000),
    },
    smoke: {
      ok,
      stopReason,
      errorMessage,
      missingParameters,
      rawTail: combined.slice(-1500),
    },
  };
}
