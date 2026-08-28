import { createProposalProvider, type ProposalProvider } from "./provider.js";
import { buildSourceBoundPrompt, type ProposalInput } from "./prompt.js";

export interface SemanticProposal {
  taskFrontUpdates: Array<{ frontId: string; action: "keep" | "park" | "complete" | "supersede"; sourceIds: string[] }>;
  claimSelections: Array<{ claimId: string; role: "constraint" | "decision" | "outcome" | "context" }>;
  narrative: Array<{ text: string; sourceIds: string[]; epistemic: "supported" | "inference" }>;
}

export interface ProposalAllowlist {
  claimIds?: readonly string[];
  frontIds?: readonly string[];
  sourceIds?: readonly string[];
  toolSourceIds?: readonly string[];
}

const ROOT_KEYS = new Set(["taskFrontUpdates", "claimSelections", "narrative", "claims"]);
const HIDDEN_KEYS = new Set(["hiddenReasoning", "reasoning", "chainOfThought", "authority"]);
const FRONT_ACTIONS = ["keep", "park", "complete", "supersede"] as const;
const CLAIM_ROLES = ["constraint", "decision", "outcome", "context"] as const;
const EPISTEMICS = ["supported", "inference"] as const;

export function parseSemanticProposal(raw: unknown, allowlist?: ProposalAllowlist): SemanticProposal {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("untrusted proposal is not an object");
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (HIDDEN_KEYS.has(key)) throw new Error(`hidden reasoning must not be persisted: ${key}`);
    if (!ROOT_KEYS.has(key)) throw new Error(`unknown key: ${key}`);
  }
  const narrative = parseNarrative(record, allowlist);
  const taskFrontUpdates = parseFronts(record.taskFrontUpdates, allowlist);
  const claimSelections = parseClaims(record.claimSelections, allowlist);
  return { taskFrontUpdates, claimSelections, narrative };
}

export async function generateSemanticProposal(
  input: ProposalInput,
  provider: ProposalProvider,
): Promise<SemanticProposal> {
  const prompt = buildSourceBoundPrompt(input);
  const raw = await provider.generate(prompt);
  return parseSemanticProposal(raw, {
    claimIds: input.knownClaimIds,
    frontIds: input.knownFrontIds,
    sourceIds: input.knownSourceIds,
    toolSourceIds: input.toolSourceIds,
  });
}

export { buildSourceBoundPrompt, createProposalProvider, type ProposalInput, type ProposalProvider };

function parseNarrative(record: Record<string, unknown>, allowlist?: ProposalAllowlist) {
  const rawItems = record.narrative ?? record.claims;
  if (rawItems === undefined) return [];
  if (!Array.isArray(rawItems)) throw new Error("narrative must be an array");
  return rawItems.map((item) => {
    const row = objectRow(item, ["text", "sourceIds", "epistemic"]);
    const sourceIds = requiredSourceIds(row.sourceIds);
    const text = asString(row.text, "text");
    if (hasConcretePath(text) && sourceIds.length === 0) throw new Error("sourceIds");
    assertKnownIds(sourceIds, allowlist?.sourceIds, "sourceIds");
    const toolOnly = sourceIds.length > 0 && sourceIds.every((id) => allowlist?.toolSourceIds?.includes(id));
    const epistemic = row.epistemic === undefined ? (toolOnly ? "inference" : "supported") : asEnum(row.epistemic, EPISTEMICS, "epistemic");
    if (toolOnly && epistemic === "supported") throw new Error("tool content is untrusted data");
    return { text, sourceIds, epistemic };
  });
}

function parseFronts(raw: unknown, allowlist?: ProposalAllowlist) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error("taskFrontUpdates must be an array");
  return raw.map((item) => {
    const row = objectRow(item, ["frontId", "action", "sourceIds"]);
    const sourceIds = requiredSourceIds(row.sourceIds);
    const frontId = asString(row.frontId, "frontId");
    assertKnownIds([frontId], allowlist?.frontIds, "frontId");
    assertKnownIds(sourceIds, allowlist?.sourceIds, "sourceIds");
    return { frontId, action: asEnum(row.action, FRONT_ACTIONS, "action"), sourceIds };
  });
}

function parseClaims(raw: unknown, allowlist?: ProposalAllowlist) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error("claimSelections must be an array");
  return raw.map((item) => {
    const row = objectRow(item, ["claimId", "role", "sourceIds"]);
    if (row.sourceIds !== undefined) requiredSourceIds(row.sourceIds);
    const claimId = asString(row.claimId, "claimId");
    assertKnownIds([claimId], allowlist?.claimIds, "claimId");
    return { claimId, role: asEnum(row.role, CLAIM_ROLES, "role") };
  });
}

function objectRow(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("untrusted row is not an object");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (HIDDEN_KEYS.has(key)) throw new Error(`hidden reasoning must not be persisted: ${key}`);
    if (!allowed.includes(key)) throw new Error(`unknown key: ${key}`);
  }
  return record;
}

function requiredSourceIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new Error("sourceIds");
  }
  return value as string[];
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} required`);
  return value;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`unknown ${field}`);
  return value as T;
}

function assertKnownIds(ids: readonly string[], known: readonly string[] | undefined, field: string): void {
  if (!known) return;
  const allowed = new Set(known);
  if (ids.some((id) => !allowed.has(id))) throw new Error(`new ${field} rejected`);
}

function hasConcretePath(text: string): boolean {
  return /(?:^|[\s"'`])(?:\.\.?\/|\/)?(?:src|lib|app|packages)\/[\w./-]+/.test(text);
}
