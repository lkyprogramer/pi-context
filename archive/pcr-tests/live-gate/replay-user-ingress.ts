import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionContext, InputEvent, InputEventResult, SessionEntry } from "@earendil-works/pi-coding-agent";
import { registerProductionUserTurnRuntime } from "../../apps/pi-context-runtime/src/composition-root.js";
import { LIVE_MODEL, LIVE_PROVIDER } from "./w1-session-jsonl.js";

/** Replay declared synthetic user inputs through production capture before live evaluation.
 * Only native entry sidecars change: message content, ids and the shared cut stay frozen.
 * Receipts and encrypted raw inputs are created separately in each candidate arm.
 */
export async function replayUserIngress(sessionFile: string, cwd: string): Promise<void> {
  const rows = readFileSync(sessionFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const header = rows[0];
  if (header?.type !== "session" || header.cwd !== cwd) throw new Error("PCR_REPLAY_SESSION_INVALID");
  let branch: SessionEntry[] = [];
  let ingressFailure: unknown;
  let messageStart: ((event: unknown, ctx: ExtensionContext) => Promise<void>) | undefined;
  let inputHook: ((event: InputEvent, ctx: ExtensionContext) => Promise<InputEventResult>) | undefined;
  const runtime = registerProductionUserTurnRuntime({
    on(name: string, handler: unknown) {
      if (name === "input") inputHook = handler as typeof inputHook;
      if (name === "message_start") messageStart = handler as typeof messageStart;
    },
  } as ExtensionAPI, { onHardFailure(error) { ingressFailure = error; } });
  const ctx = {
    cwd,
    model: { provider: LIVE_PROVIDER, id: LIVE_MODEL },
    sessionManager: {
      getSessionId: () => header.id,
      getSessionDir: () => dirname(sessionFile),
      getHeader: () => header,
      getLeafId: () => branch.at(-1)?.id ?? null,
      getBranch: () => branch,
      getEntries: () => branch,
    },
    abort() { throw new Error("PCR_REPLAY_INPUT_ABORTED"); },
  } as unknown as ExtensionContext;
  try {
    for (const row of rows.slice(1)) {
      if (row.type === "message" && row.message.role === "user") {
        if (row.ingressMetadata) throw new Error("PCR_REPLAY_INPUT_ALREADY_CAPTURED");
        const text = row.message.content.map((part: { type: string; text?: string }) => {
          if (part.type !== "text") throw new Error("PCR_REPLAY_TEXT_ONLY");
          return part.text;
        }).join("");
        const result = await inputHook!({ type: "input", inputId: `pi_input_${randomUUID()}`, text, source: "interactive", images: [] }, ctx);
        if (result.action !== "continue" || !result.ingressMetadata) throw new Error("PCR_REPLAY_INPUT_NOT_CAPTURED");
        if (ingressFailure) throw ingressFailure;
        row.ingressMetadata = result.ingressMetadata;
      }
      branch = [...branch, row];
      if (row.type === "message" && row.message.role === "user") {
        await messageStart!({ type: "message_start", message: row.message }, ctx);
        if (ingressFailure) throw ingressFailure;
      }
    }
    writeFileSync(sessionFile, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  } finally {
    await runtime.close();
  }
}
