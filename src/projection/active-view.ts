import type { NativeEntry, Scope } from "../contracts.js";
import { isFieldRef, refForField } from "../history/refs.js";
import { archiveBranch, contentFingerprint, latestCompactionId, toolCallIdOf } from "../pi/source-reader.js";
import type { ActiveField, ActiveView, OutboundMessage } from "./view-contracts.js";

const IDENTITY = new Set(["cycle", "missing-parent", "missing-leaf"]);

export function identityIncomplete(diagnostics: readonly string[]): boolean {
  return diagnostics.some((d) => IDENTITY.has(d));
}

export function buildActiveView(input: {
  scope: Scope;
  entries: readonly NativeEntry[];
  messages: readonly OutboundMessage[];
}): ActiveView {
  const walked = archiveBranch(input.entries, input.scope.leafId);
  const diagnostics = [...walked.diagnostics];
  const branch = walked.branch;
  const compactionBoundary = latestCompactionId(branch);

  const unused = branch.flatMap((entry) => {
    if (entry.message?.role !== "toolResult") return [];
    const callId = toolCallIdOf(entry.message);
    if (!callId) return [];
    return [{ entry, callId, fingerprint: contentFingerprint(entry.message.content), used: false }];
  });

  const fields: ActiveField[] = [];
  input.messages.forEach((msg, messageIndex) => {
    if (msg.role !== "toolResult") return;
    const callId = toolCallIdOf(msg);
    if (!callId) {
      diagnostics.push("unsupported");
      return;
    }
    const fingerprint = contentFingerprint(msg.content);
    const pool = unused.filter((row) => !row.used && row.callId === callId);
    const exact = pool.filter((row) => row.fingerprint === fingerprint);
    if (exact.length !== 1) {
      if (pool.length === 1 && pool[0]!.fingerprint !== fingerprint) diagnostics.push("changed");
      else if (exact.length > 1 || pool.length > 1) diagnostics.push("ambiguous");
      return;
    }
    const hit = exact[0]!;
    hit.used = true;
    const blocks = Array.isArray(msg.content)
      ? msg.content
      : typeof msg.content === "string"
        ? [{ type: "text", text: msg.content }]
        : [];
    if (blocks.some((block) => !block || typeof block !== "object" || (block as { type?: string }).type !== "text")) {
      diagnostics.push("unsupported");
      return;
    }
    blocks.forEach((block, blockIndex) => {
      if (!block || typeof block !== "object") return;
      const rec = block as { type?: string; text?: unknown };
      if (rec.type !== "text" || typeof rec.text !== "string") return;
      const ref = refForField(input.scope, hit.entry, blockIndex);
      if (!isFieldRef(ref) || ref.kind !== "text") return;
      fields.push({
        key: `${hit.entry.id}:${blockIndex}`,
        ref,
        messageIndex,
        blockIndex,
        rawText: rec.text,
      });
    });
  });

  return {
    scope: input.scope,
    branch,
    messages: input.messages,
    fields,
    compactionBoundary,
    diagnostics,
  };
}

export function viewFromEntries(scope: Scope, entries: readonly NativeEntry[]): ActiveView {
  const walked = archiveBranch(entries, scope.leafId);
  const source = walked.branch.length > 0 ? walked.branch : entries;
  const messages = source
    .filter((entry) => entry.type === "message" && entry.message)
    .map((entry) => entry.message!);
  return buildActiveView({ scope, entries, messages });
}

export function mappingFromView(view: ActiveView): Map<number, { entryId: string }> {
  const mapping = new Map<number, { entryId: string }>();
  for (const field of view.fields) {
    mapping.set(field.messageIndex, { entryId: field.ref.entryId });
  }
  return mapping;
}
