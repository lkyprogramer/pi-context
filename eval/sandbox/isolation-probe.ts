import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { T21_IMAGE } from "./image.js";

export function imageAvailable(image = T21_IMAGE): boolean {
  const r = spawnSync("docker", ["image", "inspect", image], { encoding: "utf8", timeout: 8000 });
  return r.status === 0;
}

export function probeIsolation(): { ok: boolean; blocked?: string; details?: Record<string, unknown> } {
  const info = spawnSync("docker", ["info"], { encoding: "utf8", timeout: 8000 });
  if (info.status !== 0) {
    return { ok: false, blocked: info.stderr || info.error?.message || "docker info failed" };
  }
  if (!imageAvailable()) {
    return { ok: false, blocked: `T21 image missing: ${T21_IMAGE}` };
  }
  const hostDir = mkdtempSync(join(tmpdir(), "pctx-host-secret-"));
  const secretPath = join(hostDir, "auth.json");
  writeFileSync(secretPath, JSON.stringify({ apiKey: "SYNTHETIC_SECRET_123" }));
  try {
    const isolated = execFileSync("docker", [
      "run", "--rm",
      "--network", "none",
      "--read-only",
      "--tmpfs", "/tmp:uid=1000,gid=1000",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--memory", "256m",
      "--pids-limit", "128",
      "--user", "1000:1000",
      T21_IMAGE,
      "sh", "-c",
      `set -e
       test ! -r ${JSON.stringify(secretPath)}
       test ! -r /var/run/docker.sock
       test ! -r /Users/luo/.pi/agent/auth.json
       echo UNREADABLE
       node -v
       javac -version
       pi --version`,
    ], { encoding: "utf8", timeout: 60_000 });
    if (!isolated.includes("UNREADABLE")) {
      return { ok: false, blocked: "container could read host secret or docker.sock", details: { isolated: isolated.trim() } };
    }
    return {
      ok: true,
      details: {
        image: T21_IMAGE,
        hostPathReadable: false,
        dockerSockReadable: false,
        versions: isolated.trim(),
      },
    };
  } catch (error) {
    return { ok: false, blocked: String(error).slice(0, 800) };
  } finally {
    rmSync(hostDir, { recursive: true, force: true });
  }
}
