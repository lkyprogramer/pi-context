import type { NativeEntry } from "../contracts.js";

export function exposedEntryIds(entries: readonly NativeEntry[]): Set<string> {
  const exposed = new Set<string>();
  const pending: string[] = [];
  for (const entry of entries) {
    if (entry.type === "message" && entry.message?.role === "toolResult") {
      pending.push(entry.id);
      continue;
    }
    if (entry.type === "message" && entry.message?.role === "assistant") {
      const stop = entry.message.stopReason;
      const usage = entry.message.usage;
      const ok =
        stop !== "error" &&
        stop !== "aborted" &&
        usage != null &&
        ((usage.totalTokens ?? 0) > 0 || (usage.input ?? 0) > 0);
      if (ok) {
        for (const id of pending) exposed.add(id);
        pending.length = 0;
      }
    }
  }
  return exposed;
}
