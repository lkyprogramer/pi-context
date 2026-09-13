import { utf8Bytes, type NativeEntry } from "../contracts.js";
import { blocksOf } from "../history/refs.js";
import { archiveBranch } from "../pi/source-reader.js";
import { stubHead } from "./planner.js";

export const EVIDENCE_INDEX_BUDGET_BYTES = 1536;
export const EVIDENCE_INDEX_HEAD_CHARS = 80;
export const EVIDENCE_INDEX_HEADER = "<pctx-evidence>";
export const EVIDENCE_INDEX_FOOTER = "</pctx-evidence>";
export const UPDATE_PLAN_TOOL = "update_plan";

export interface EvidenceIndexLine {
  entryId: string;
  tool: string;
  head: string;
  bytes: number;
  reserved: boolean;
}

export interface EvidenceIndex {
  text: string;
  lines: EvidenceIndexLine[];
  bytes: number;
}

export function toolResultText(entry: NativeEntry): string {
  return blocksOf(entry)
    .map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .join("");
}

export function flattenHead(text: string, maxChars = EVIDENCE_INDEX_HEAD_CHARS): string {
  return stubHead(text, maxChars).replace(/\s+/g, " ").trim().slice(0, maxChars);
}

export function formatEvidenceLine(line: EvidenceIndexLine): string {
  const tool = line.tool.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim() || "tool";
  return `id=${line.entryId} tool=${tool} head=${line.head} bytes=${line.bytes}`;
}

export function formatEvidenceIndex(lines: readonly EvidenceIndexLine[]): string {
  if (lines.length === 0) return "";
  return [EVIDENCE_INDEX_HEADER, ...lines.map(formatEvidenceLine), EVIDENCE_INDEX_FOOTER].join("\n");
}

export function attachEvidenceIndex(previousSummary: string | undefined, indexText: string): string {
  const previous = previousSummary?.trim() ?? "";
  if (!indexText) return previous;
  return previous ? `${previous}\n\n${indexText}` : indexText;
}

function lineFor(entry: NativeEntry, reserved: boolean): EvidenceIndexLine | null {
  if (entry.message?.role !== "toolResult") return null;
  if (entry.message.toolName === "pctx_history") return null;
  const text = toolResultText(entry);
  if (!text) return null;
  return {
    entryId: entry.id,
    tool: typeof entry.message.toolName === "string" && entry.message.toolName ? entry.message.toolName : "tool",
    head: flattenHead(text),
    bytes: utf8Bytes(text).length,
    reserved,
  };
}

function newestFirst(
  entries: readonly NativeEntry[],
  leafId: string | null,
): NativeEntry[] {
  const walked = leafId ? archiveBranch(entries, leafId) : { branch: [...entries], diagnostics: [] as string[] };
  const source = walked.diagnostics.length === 0 && walked.branch.length > 0 ? walked.branch : entries;
  return [...source].reverse();
}

/**
 * Deterministic compact-time evidence index. Newest derived-exposed tool results
 * first; sibling-branch ids (not in visibleEntryIds) never appear. Entries the
 * model already retrieved via pctx_history are omitted, except the latest
 * update_plan result, which is reserved so a SoL-Pi OCC wipe can still be read back.
 */
export function buildEvidenceIndex(input: {
  entries: readonly NativeEntry[];
  visibleEntryIds: ReadonlySet<string>;
  exposed: ReadonlySet<string>;
  readEntryIds?: ReadonlySet<string>;
  leafId?: string | null;
  budgetBytes?: number;
}): EvidenceIndex {
  const budget = input.budgetBytes ?? EVIDENCE_INDEX_BUDGET_BYTES;
  const read = input.readEntryIds ?? new Set<string>();
  const ordered = newestFirst(input.entries, input.leafId ?? null);
  let reserved: EvidenceIndexLine | null = null;
  const regular: EvidenceIndexLine[] = [];
  for (const entry of ordered) {
    if (!input.visibleEntryIds.has(entry.id)) continue;
    const line = lineFor(entry, entry.message?.toolName === UPDATE_PLAN_TOOL);
    if (!line) continue;
    if (line.reserved && !reserved) {
      reserved = line;
      continue;
    }
    if (!input.exposed.has(entry.id)) continue;
    if (read.has(entry.id)) continue;
    regular.push(line);
  }
  const candidates = reserved ? [reserved, ...regular.filter((line) => line.entryId !== reserved!.entryId)] : regular;
  const fitted: EvidenceIndexLine[] = [];
  for (const line of candidates) {
    const next = formatEvidenceIndex([...fitted, line]);
    if (utf8Bytes(next).length <= budget) fitted.push(line);
  }
  const text = formatEvidenceIndex(fitted);
  return { text, lines: fitted, bytes: utf8Bytes(text).length };
}
