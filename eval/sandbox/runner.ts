import { probeIsolation } from "./isolation-probe.js";

export function runSandboxed(_cmd: string): { status: "ok" | "blocked"; error?: string } {
  const probe = probeIsolation();
  if (!probe.ok) return { status: "blocked", error: probe.blocked };
  return { status: "ok" };
}
