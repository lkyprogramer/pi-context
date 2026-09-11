// R02 copies to test/helpers/context-audit-fixture.ts. No provider, clock or network.
import type { NativeEntry } from "../../src/contracts.js";
export function user(id: string, parentId: string | null, text = "question"): NativeEntry {
  return { id, parentId, type: "message", message: {
    role: "user", content: [{ type: "text", text }] } };
}
export function call(id: string, parentId: string | null, callId: string): NativeEntry {
  return { id, parentId, type: "message", message: {
    role: "assistant", content: [{ type: "toolCall", id: callId, name: "read", arguments: { path: "f" } }],
    stopReason: "toolUse", usage: { input: 1, totalTokens: 2 } } };
}
export function result(id: string, parentId: string | null, callId: string, text: string): NativeEntry {
  return { id, parentId, type: "message", message: {
    role: "toolResult", toolCallId: callId, toolName: "read", isError: false,
    content: [{ type: "text", text }] } };
}
export function done(id: string, parentId: string | null): NativeEntry {
  return { id, parentId, type: "message", message: {
    role: "assistant", content: [{ type: "text", text: "done" }],
    stopReason: "stop", usage: { input: 2, totalTokens: 3 } } };
}
export function archivedFixture(): { entries: NativeEntry[]; messages: NonNullable<NativeEntry["message"]>[]; leaf: string } {
  const entries: NativeEntry[] = [user("u", null), call("c", "u", "tc"),
    result("r", "c", "tc", "x".repeat(80000)), done("d", "r"), user("tail", "d")];
  let parent="tail";
  for (let i=2;i<=5;i++) {
    entries.push(call(`c${i}`,parent,`new${i}`),result(`r${i}`,`c${i}`,`new${i}`,"t".repeat(20000)),done(`d${i}`,`r${i}`));
    parent=`d${i}`;
  }
  const boundary={id:"compact",parentId:parent,type:"compaction",summary:"old summarized",firstKeptEntryId:"tail"};
  entries.push(boundary,user("now","compact"));
  return { entries, messages: [
    {role:"compactionSummary",content:[{type:"text",text:"old summarized"}]},
    ...entries.slice(4,-2).map(e=>structuredClone(e.message!)),
    structuredClone(entries.at(-1)!.message!),
  ], leaf:"now" };
}
