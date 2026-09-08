/**
 * Arm identity contract. An episode whose runtime identity does not match its manifest is `blocked`, never counted.
 *   assertArm(manifest, statusJson | null, agentDir) → { ok, reason }
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function assertArm(manifest, statusJson, agentDir) {
  const settingsPath = join(agentDir, "settings.json");
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
  const extensions = Array.isArray(settings.extensions) ? settings.extensions : [];
  if (manifest.arm === "native") {
    if (extensions.length) return { ok: false, reason: `native arm but extensions configured: ${extensions.join(",")}` };
    if (statusJson) return { ok: false, reason: "native arm but plugin status file exists" };
    return { ok: true, reason: "native: no plugin" };
  }
  // Profile is the arm identity; check it before filesystem so a wrong resolvedProfile is never counted as "not loaded".
  if (statusJson && statusJson.resolvedProfile !== manifest.arm) {
    return { ok: false, reason: `profile mismatch: manifest ${manifest.arm} vs resolved ${statusJson.resolvedProfile}` };
  }
  if (!statusJson) {
    if (!extensions.length) return { ok: false, reason: `${manifest.arm} arm but no extensions configured` };
    return { ok: false, reason: `${manifest.arm} arm but plugin wrote no status (not loaded or crashed)` };
  }
  if (manifest.configHash && statusJson.configHash !== manifest.configHash) return { ok: false, reason: `configHash mismatch ${statusJson.configHash} vs frozen ${manifest.configHash}` };
  if (statusJson.hostVersion && statusJson.hostVersion !== "0.85.1") return { ok: false, reason: `hostVersion ${statusJson.hostVersion} != 0.85.1` };
  if (manifest.hostVersion && statusJson.hostVersion && statusJson.hostVersion !== manifest.hostVersion) {
    return { ok: false, reason: `hostVersion mismatch ${statusJson.hostVersion} vs ${manifest.hostVersion}` };
  }
  if (Array.isArray(statusJson.warnings) && statusJson.warnings.some((w) => /config/i.test(w))) return { ok: false, reason: `config warnings: ${statusJson.warnings.join("; ")}` };
  return { ok: true, reason: `${manifest.arm}: profile and identity match` };
}
