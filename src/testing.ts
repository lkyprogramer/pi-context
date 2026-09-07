import { hashCanonical, type ContentBlock, type NativeEntry } from "./contracts.js";

export type HostOutcome = "success" | "error" | "abort" | "http200-stream-error";

export interface BranchFixture {
  sessionId: string;
  entries: NativeEntry[];
  visibleIds: string[];
}

export interface BatchFixture {
  assistantId: string;
  toolCallIds: string[];
  resultEntryIds: string[];
  complete: boolean;
}

export function textBlocks(...texts: string[]): ContentBlock[] {
  return texts.map((text) => ({ type: "text", text }));
}

export function imageBlock(data = "iVBORw0KGgo=", mimeType = "image/png"): ContentBlock {
  return { type: "image", mimeType, data };
}

export function userEntry(id: string, parentId: string | null, content: ContentBlock[] | string): NativeEntry {
  return { id, parentId, type: "message", message: { role: "user", content } };
}

export function assistantEntry(
  id: string,
  parentId: string | null,
  content: ContentBlock[],
  stopReason: string = "stop",
): NativeEntry {
  return { id, parentId, type: "message", message: { role: "assistant", content, stopReason } };
}

export function toolResultEntry(
  id: string,
  parentId: string | null,
  toolCallId: string,
  content: ContentBlock[],
): NativeEntry {
  return { id, parentId, type: "message", toolCallId, message: { role: "tool", content } };
}

export function independentBranch(ids = ["a", "b"]): BranchFixture {
  const entries: NativeEntry[] = [
    userEntry("root", null, textBlocks("start")),
    assistantEntry("a", "root", textBlocks("branch-a")),
    assistantEntry("sibling", "root", textBlocks("other-branch")),
    userEntry("b", "a", textBlocks("keep-http-paths")),
  ];
  return { sessionId: "sess-a", entries, visibleIds: ["root", ...ids] };
}

export function imageTurn(): BranchFixture {
  const entries: NativeEntry[] = [
    userEntry("u1", null, [imageBlock(), { type: "text", text: "inspect this" }]),
    assistantEntry("a1", "u1", textBlocks("ok"), "stop"),
  ];
  return { sessionId: "sess-img", entries, visibleIds: ["u1", "a1"] };
}

export function completeBatch(): BatchFixture {
  return { assistantId: "asst-1", toolCallIds: ["c1", "c2"], resultEntryIds: ["r1", "r2"], complete: true };
}

export function missingBatch(): BatchFixture {
  return { assistantId: "asst-2", toolCallIds: ["c1", "c2"], resultEntryIds: ["r1"], complete: false };
}

export function failedRequest(kind: HostOutcome = "error"): { outcome: HostOutcome; exposed: false } {
  return { outcome: kind, exposed: false };
}

export function neverAssumeHostSuccess(): { alwaysSuccess: false } {
  return { alwaysSuccess: false };
}

export function sourceHashFor(entry: NativeEntry): string {
  return hashCanonical(entry.message?.content ?? entry);
}
