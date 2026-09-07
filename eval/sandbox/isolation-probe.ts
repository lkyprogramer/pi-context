import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SANDBOX_IMAGE = process.env.PCR_SANDBOX_IMAGE || "debian:latest";

export function probeIsolation(): { ok: boolean; blocked?: string; details?: Record<string, unknown> } {
  const info = spawnSync("docker", ["info"], { encoding: "utf8", timeout: 8000 });
  if (info.status !== 0) {
    return { ok: false, blocked: info.stderr || info.error?.message || "docker info failed" };
  }
  const hostDir = mkdtempSync(join(tmpdir(), "pctx-host-secret-"));
  const secretPath = join(hostDir, "auth.json");
  writeFileSync(secretPath, JSON.stringify({ apiKey: "SYNTHETIC_SECRET_123" }));
  try {
    const isolated = execFileSync("docker", [
      "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL", "--user", "65534:65534",
      SANDBOX_IMAGE,
      "sh", "-c", `if [ -r ${JSON.stringify(secretPath)} ]; then echo READABLE; else echo UNREADABLE; fi`,
    ], { encoding: "utf8", timeout: 30_000 });
    if (!isolated.includes("UNREADABLE")) {
      return { ok: false, blocked: "container could read host secret path", details: { isolated: isolated.trim() } };
    }
    return { ok: true, details: { image: SANDBOX_IMAGE, hostPathReadable: false } };
  } catch (error) {
    return { ok: false, blocked: String(error).slice(0, 500) };
  } finally {
    rmSync(hostDir, { recursive: true, force: true });
  }
}
