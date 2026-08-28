import { InputCorrelator, type ExpandedHostMessage, type RawInput } from "../../kernel/src/directives/raw-input.js";

export interface InputCorrelationHost {
  on(hook: string, handler: (event: { content?: unknown }) => unknown): void;
}

interface InputEventBody extends RawInput {
  sessionId: string;
}

interface MessageEndBody extends ExpandedHostMessage {
  sessionId?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function bindInputCorrelation(host: InputCorrelationHost, correlator: InputCorrelator): void {
  host.on("input", (event) => {
    const body = asRecord(event.content) as unknown as InputEventBody;
    if (typeof body.text !== "string" || typeof body.sessionId !== "string") return;
    correlator.capture({
      sessionId: body.sessionId,
      source: body.source,
      text: body.text,
      at: body.at,
      trustedRpc: body.trustedRpc,
      kind: body.kind,
    });
  });
  host.on("message_end", (event) => {
    const body = asRecord(event.content) as unknown as MessageEndBody;
    if (typeof body.hostMessageId !== "string" || typeof body.expandedText !== "string") return;
    const sessionId = body.sessionId ?? "s1";
    correlator.linkNext(sessionId, body);
  });
}
