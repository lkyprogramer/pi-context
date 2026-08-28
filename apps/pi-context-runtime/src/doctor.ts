import { probePiCapabilities, REQUIRED_PI_CAPABILITIES } from "../../../packages/pi-adapter/src/capabilities.js";
import { checkKnownOwnerConflicts, type ConflictPolicy } from "./conflicts.js";

export interface DoctorEnvironment {
  packages: readonly string[];
  nodeVersion?: string;
  piVersion?: string;
  capabilities?: readonly string[];
  trusted?: boolean;
  storageWritable?: boolean;
  keyAvailable?: boolean;
  diskFreeBytes?: number;
  dataRoot?: string;
  secret?: string;
}

export interface DoctorConfig {
  conflictPolicy: ConflictPolicy;
}

export interface DoctorFinding {
  code: string;
  severity: "blocking" | "warning" | "info";
  message: string;
}

export interface DoctorReport {
  ready: boolean;
  findings: DoctorFinding[];
  limitation: string;
}

export function fixtureEnvironment(partial: Partial<DoctorEnvironment> = {}): DoctorEnvironment {
  return {
    packages: [],
    nodeVersion: process.versions.node,
    piVersion: "0.84.3",
    capabilities: [...REQUIRED_PI_CAPABILITIES],
    trusted: true,
    storageWritable: true,
    keyAvailable: true,
    diskFreeBytes: 64 * 1024 * 1024,
    ...partial,
  };
}

export async function runRuntimeDoctor(env: DoctorEnvironment, config: DoctorConfig): Promise<DoctorReport> {
  const findings = [
    ...checkNodeAndPiVersion(env),
    ...checkRequiredCapabilities(env),
    ...checkKnownOwnerConflicts(env.packages, config.conflictPolicy).map((item) => ({
      code: item.code,
      severity: item.severity,
      message: `known context owner installed: ${item.packageName}`,
    })),
    ...(await checkStorageAndKeys(env)),
    ...checkDiskAndPermissions(env),
    ...checkProjectTrust(env),
    {
      code: "PCR_UNKNOWN_PLUGIN_LIMIT",
      severity: "info" as const,
      message: "unknown third-party handlers are not claimed detected",
    },
  ];
  return {
    ready: findings.every((item) => item.severity !== "blocking"),
    findings: findings.map(scrubFinding),
    limitation: "unknown plugins are not claimed detected",
  };
}

function checkNodeAndPiVersion(env: DoctorEnvironment): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const major = Number((env.nodeVersion ?? "").split(".")[0]);
  if (!Number.isFinite(major) || major < 22) {
    findings.push({ code: "PCR_NODE_UNSUPPORTED", severity: "blocking", message: "Node 22+ required" });
  }
  if (env.piVersion && !/^0\.84\./.test(env.piVersion)) {
    findings.push({ code: "PCR_PI_VERSION_UNVERIFIED", severity: "warning", message: "Pi version is outside the locked baseline" });
  }
  return findings;
}

function checkRequiredCapabilities(env: DoctorEnvironment): DoctorFinding[] {
  const probe = probePiCapabilities(new Set(env.capabilities ?? []));
  if (probe.ready) return [];
  return [{ code: "PCR_CAPABILITY_MISSING", severity: "blocking", message: `missing:${probe.missing.join(",")}` }];
}

async function checkStorageAndKeys(env: DoctorEnvironment): Promise<DoctorFinding[]> {
  const findings: DoctorFinding[] = [];
  if (env.storageWritable === false) findings.push({ code: "PCR_STORAGE_UNWRITABLE", severity: "blocking", message: "storage is not writable" });
  if (env.keyAvailable === false) findings.push({ code: "PCR_KEY_MISSING", severity: "blocking", message: "workspace key is missing" });
  return findings;
}

function checkDiskAndPermissions(env: DoctorEnvironment): DoctorFinding[] {
  if ((env.diskFreeBytes ?? 0) < 8 * 1024 * 1024) {
    return [{ code: "PCR_DISK_LOW", severity: "blocking", message: "insufficient disk" }];
  }
  return [];
}

function checkProjectTrust(env: DoctorEnvironment): DoctorFinding[] {
  if (env.trusted === false) return [{ code: "PCR_PROJECT_UNTRUSTED", severity: "blocking", message: "project trust is required" }];
  return [];
}

function scrubFinding(finding: DoctorFinding): DoctorFinding {
  return {
    ...finding,
    message: finding.message.replace(/\/(?:Users|home|tmp)\/[^\s]+/g, "[path]").replace(/sk-[A-Za-z0-9]+/g, "[secret]"),
  };
}
