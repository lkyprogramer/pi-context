import { execFileSync } from "node:child_process";
import { probeIsolation } from "./isolation-probe.js";

const SANDBOX_IMAGE = process.env.PCR_SANDBOX_IMAGE || "debian:latest";

export function runSandboxed(cmd: string): { status: "ok" | "blocked"; error?: string; stdout?: string } {
  const probe = probeIsolation();
  if (!probe.ok) return { status: "blocked", error: probe.blocked };
  try {
    const stdout = execFileSync("docker", [
      "run", "--rm", "--network", "none", "--read-only", "--tmpfs", "/tmp", "--cap-drop", "ALL", "--user", "65534:65534",
      SANDBOX_IMAGE,
      "sh", "-c", cmd,
    ], { encoding: "utf8", timeout: 30_000 });
    return { status: "ok", stdout };
  } catch (error) {
    return { status: "blocked", error: String(error).slice(0, 500) };
  }
}
