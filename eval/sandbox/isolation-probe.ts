import { execFileSync } from "node:child_process";

export function probeIsolation(): { ok: boolean; blocked?: string } {
  try {
    execFileSync("docker", ["info"], { stdio: "pipe", timeout: 5000 });
    return { ok: true };
  } catch (error) {
    return { ok: false, blocked: String(error) };
  }
}
