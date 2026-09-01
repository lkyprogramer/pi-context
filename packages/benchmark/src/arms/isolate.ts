import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type LiveFourArmId = "B0" | "B1" | "B2" | "F0";

export type LiveFourMaterializer = "off" | "identity" | "pcr";

export type LiveFourCompactor =
  | "pi-native"
  | "pcr-deterministic-checkpoint"
  | "pcr-materialized-checkpoint"
  | "none";

export interface LiveFourIdentity {
  arm: LiveFourArmId;
  fromHook: boolean;
  extension: boolean;
  compact: boolean;
  materializer: LiveFourMaterializer;
  compactor: LiveFourCompactor;
  ingress: "w1";
  fullContext: boolean;
}

export interface IsolatedArmHome {
  arm: LiveFourArmId;
  cwd: string;
  agentDir: string;
  sessionFile: string;
  piHome: string;
}

export type ArmIsolateErrorCode =
  | "PCR_ARM_ISOLATE_INPUT_INVALID"
  | "PCR_ARM_ISOLATE_SHARED_CWD"
  | "PCR_ARM_ISOLATE_TOOLS_UNSAFE"
  | "PCR_ARM_STRING_STUB";

export class ArmIsolateError extends TypeError {
  readonly code: ArmIsolateErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ArmIsolateErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "ArmIsolateError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export const LIVE_FOUR_ARMS: readonly LiveFourArmId[] = Object.freeze(["B0", "B1", "B2", "F0"]);

export const LIVE_FOUR_IDENTITIES: Readonly<Record<LiveFourArmId, LiveFourIdentity>> = Object.freeze({
  B0: Object.freeze({
    arm: "B0",
    fromHook: false,
    extension: false,
    compact: true,
    materializer: "off",
    compactor: "pi-native",
    ingress: "w1",
    fullContext: false,
  }),
  B1: Object.freeze({
    arm: "B1",
    fromHook: true,
    extension: true,
    compact: true,
    materializer: "identity",
    compactor: "pcr-deterministic-checkpoint",
    ingress: "w1",
    fullContext: false,
  }),
  B2: Object.freeze({
    arm: "B2",
    fromHook: true,
    extension: true,
    compact: true,
    materializer: "pcr",
    compactor: "pcr-materialized-checkpoint",
    ingress: "w1",
    fullContext: false,
  }),
  F0: Object.freeze({
    arm: "F0",
    fromHook: false,
    extension: false,
    compact: false,
    materializer: "off",
    compactor: "none",
    ingress: "w1",
    fullContext: true,
  }),
});

const ARMS = new Set<LiveFourArmId>(LIVE_FOUR_ARMS);
const STUB_TEXT = /^(?:native|identity|pcr):\d+:/u;
const STUB_MARKERS = /SIMULATED|\[PCR\]|string-marker/iu;

function fail(code: ArmIsolateErrorCode, details: Record<string, unknown> = {}): never {
  throw new ArmIsolateError(code, details);
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) fail("PCR_ARM_ISOLATE_INPUT_INVALID", { field });
}

export function liveFourIdentity(arm: LiveFourArmId): LiveFourIdentity {
  if (typeof arm !== "string" || !ARMS.has(arm)) fail("PCR_ARM_ISOLATE_INPUT_INVALID", { field: "arm" });
  return LIVE_FOUR_IDENTITIES[arm];
}

export function assertProductArmText(text: string): void {
  if (typeof text !== "string") fail("PCR_ARM_ISOLATE_INPUT_INVALID", { field: "text" });
  if (STUB_TEXT.test(text) || STUB_MARKERS.test(text)) {
    fail("PCR_ARM_STRING_STUB", { preview: text.slice(0, 80) });
  }
}

export function assertIndependentWorkspaces(homes: readonly IsolatedArmHome[]): void {
  if (!Array.isArray(homes) || homes.length === 0) fail("PCR_ARM_ISOLATE_INPUT_INVALID", { field: "homes" });
  const cwds = new Set<string>();
  const agents = new Set<string>();
  const sessions = new Set<string>();
  for (const home of homes) {
    if (!home || typeof home !== "object") fail("PCR_ARM_ISOLATE_INPUT_INVALID", { field: "home" });
    requireNonEmpty(home.cwd, "home.cwd");
    requireNonEmpty(home.agentDir, "home.agentDir");
    requireNonEmpty(home.sessionFile, "home.sessionFile");
    const cwd = resolve(home.cwd);
    const agentDir = resolve(home.agentDir);
    const sessionFile = resolve(home.sessionFile);
    if (cwds.has(cwd)) fail("PCR_ARM_ISOLATE_SHARED_CWD", { cwd });
    if (agents.has(agentDir)) fail("PCR_ARM_ISOLATE_SHARED_CWD", { field: "agentDir", agentDir });
    if (sessions.has(sessionFile)) fail("PCR_ARM_ISOLATE_SHARED_CWD", { field: "sessionFile", sessionFile });
    cwds.add(cwd);
    agents.add(agentDir);
    sessions.add(sessionFile);
  }
}

export function requireToolsSafe(homes: readonly IsolatedArmHome[]): void {
  assertIndependentWorkspaces(homes);
  if (homes.length < 2) fail("PCR_ARM_ISOLATE_TOOLS_UNSAFE", { reason: "need-two-arms" });
}

function rewriteSessionCwd(sessionFile: string, cwd: string): void {
  const raw = readFileSync(sessionFile, "utf8");
  const lines = raw.split("\n");
  let rewritten = false;
  const next = lines.map((line) => {
    if (!line.trim()) return line;
    try {
      const row = JSON.parse(line) as { type?: string; cwd?: string };
      if (row.type === "session") {
        row.cwd = cwd;
        rewritten = true;
        return JSON.stringify(row);
      }
    } catch {
      fail("PCR_ARM_ISOLATE_INPUT_INVALID", { field: "seedSessionFile" });
    }
    return line;
  });
  if (!rewritten) fail("PCR_ARM_ISOLATE_INPUT_INVALID", { field: "seedSessionFile.session" });
  writeFileSync(sessionFile, next.join("\n"));
}

export function createIsolatedArmHomes(input: {
  root: string;
  seedSessionFile: string;
  seedWorkspaceDir: string;
  arms?: readonly LiveFourArmId[];
}): IsolatedArmHome[] {
  if (!input || typeof input !== "object") fail("PCR_ARM_ISOLATE_INPUT_INVALID", { field: "input" });
  requireNonEmpty(input.root, "root");
  requireNonEmpty(input.seedSessionFile, "seedSessionFile");
  requireNonEmpty(input.seedWorkspaceDir, "seedWorkspaceDir");
  if (!existsSync(input.seedSessionFile)) fail("PCR_ARM_ISOLATE_INPUT_INVALID", { field: "seedSessionFile" });
  if (!existsSync(input.seedWorkspaceDir)) fail("PCR_ARM_ISOLATE_INPUT_INVALID", { field: "seedWorkspaceDir" });
  const arms: readonly LiveFourArmId[] = input.arms ?? LIVE_FOUR_ARMS;
  if (arms.length === 0) fail("PCR_ARM_ISOLATE_INPUT_INVALID", { field: "arms" });
  const homes: IsolatedArmHome[] = [];
  for (const arm of arms) {
    if (!ARMS.has(arm)) fail("PCR_ARM_ISOLATE_INPUT_INVALID", { field: "arm" });
    const armRoot = join(input.root, `arm-${arm}`);
    const cwd = join(armRoot, "workspace");
    const agentDir = join(armRoot, "agent");
    const sessionFile = join(armRoot, "session.jsonl");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(armRoot, { recursive: true });
    cpSync(input.seedWorkspaceDir, cwd, { recursive: true });
    copyFileSync(input.seedSessionFile, sessionFile);
    rewriteSessionCwd(sessionFile, cwd);
    homes.push(Object.freeze({
      arm,
      cwd: resolve(cwd),
      agentDir: resolve(agentDir),
      sessionFile: resolve(sessionFile),
      piHome: resolve(agentDir),
    }));
  }
  assertIndependentWorkspaces(homes);
  requireToolsSafe(homes);
  return homes;
}

export function piLaunchPlan(arm: LiveFourArmId, input: {
  sessionFile: string;
  extensionPath: string;
  provider: string;
  model: string;
}): { args: string[]; env: Readonly<Record<string, string>>; compact: boolean; fromHook: boolean } {
  const identity = liveFourIdentity(arm);
  if (!input || typeof input !== "object") fail("PCR_ARM_ISOLATE_INPUT_INVALID", { field: "input" });
  requireNonEmpty(input.sessionFile, "sessionFile");
  requireNonEmpty(input.extensionPath, "extensionPath");
  requireNonEmpty(input.provider, "provider");
  requireNonEmpty(input.model, "model");
  const args = [
    "--no-extensions",
    "--offline",
    "--session-dir",
    dirname(input.sessionFile),
    "--session",
    input.sessionFile,
    "--provider",
    input.provider,
    "--model",
    input.model,
  ];
  if (identity.extension) args.unshift("-e", input.extensionPath);
  return {
    args,
    env: Object.freeze({
      PCR_EVAL_ARM: arm,
      PCR_EVAL_MATERIALIZER: identity.materializer,
    }),
    compact: identity.compact,
    fromHook: identity.fromHook,
  };
}
