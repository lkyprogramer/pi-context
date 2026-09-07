import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { T21_IMAGE } from "./image.js";
import { probeIsolation } from "./isolation-probe.js";

export { T21_IMAGE };

export function sandboxDockerArgs(input: {
  workDir: string;
  socketDir?: string;
  command?: string[];
}): string[] {
  const args = [
    "run",
    "--rm",
    "--network", "none",
    "--read-only",
    "--tmpfs", "/tmp:uid=1000,gid=1000",
    "--tmpfs", "/home/node:uid=1000,gid=1000",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--memory", "512m",
    "--pids-limit", "256",
    "--user", "1000:1000",
    "-v", `${input.workDir}:/work:rw`,
    "-w", "/work",
  ];
  if (input.socketDir) {
    args.push("-v", `${input.socketDir}:/run/pctx:rw`);
  }
  args.push(T21_IMAGE, ...(input.command ?? ["true"]));
  const mounts: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "-v" || args[i] === "--volume") mounts.push(args[i + 1] ?? "");
  }
  for (const mount of mounts) {
    if (mount.includes("docker.sock") || mount.startsWith("/Users/") || mount.startsWith("/home/")) {
      throw new Error("sandbox args must not mount docker.sock or host home");
    }
  }
  return args;
}

export function runSandboxed(cmd: string, workDir?: string): { status: "ok" | "blocked"; error?: string; stdout?: string } {
  const probe = probeIsolation();
  if (!probe.ok) return { status: "blocked", error: probe.blocked };
  const created = workDir ? null : mkdtempSync(join(tmpdir(), "pctx-sandbox-work-"));
  const dir = workDir ?? created!;
  try {
    const args = sandboxDockerArgs({ workDir: dir, command: ["sh", "-c", cmd] });
    const stdout = execFileSync("docker", args, { encoding: "utf8", timeout: 60_000 });
    return { status: "ok", stdout };
  } catch (error) {
    return { status: "blocked", error: String(error).slice(0, 500) };
  } finally {
    if (created) rmSync(created, { recursive: true, force: true });
  }
}
