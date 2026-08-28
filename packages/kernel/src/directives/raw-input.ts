import { domainHash, type SourceClass } from "../../../contracts/src/index.js";

export type InputSource = "interactive" | "rpc" | "extension";

export interface RawInput {
  sessionId: string;
  source: InputSource;
  text: string;
  at: number;
  trustedRpc?: boolean;
  kind?: "steer" | "follow-up" | "prompt";
}

export interface RawInputReceipt {
  operationId: string;
  sessionId: string;
  rawText: string;
  sourceClass: SourceClass;
  source: InputSource;
  at: number;
  contentHash: string;
  sequence: number;
  kind?: RawInput["kind"];
  expired: boolean;
}

export interface ExpandedHostMessage {
  hostMessageId: string;
  expandedText: string;
  at: number;
  sessionId?: string;
}

export interface LinkedInputReceipt extends RawInputReceipt {
  hostMessageId: string;
  expandedText: string;
}

export function classifyInputSource(source: InputSource, trustedRpc = false): SourceClass {
  if (source === "interactive") return "authenticated-user";
  if (source === "rpc" && trustedRpc) return "authenticated-user";
  if (source === "extension") return "agent-derived";
  return "untrusted-user";
}

function buildRawReceipt(input: RawInput, sourceClass: SourceClass, sequence: number): RawInputReceipt {
  const contentHash = domainHash("input", input.text);
  return {
    operationId: `in_${domainHash("input-op", { sessionId: input.sessionId, sequence, at: input.at, contentHash })}`,
    sessionId: input.sessionId,
    rawText: input.text,
    sourceClass,
    source: input.source,
    at: input.at,
    contentHash,
    sequence,
    kind: input.kind,
    expired: false,
  };
}

export class InputCorrelator {
  private readonly sequences = new Map<string, number>();
  private readonly receipts = new Map<string, RawInputReceipt>();
  private readonly pending = new Map<string, string[]>();
  private readonly linked = new Map<string, LinkedInputReceipt>();

  capture(input: RawInput): RawInputReceipt {
    const sequence = (this.sequences.get(input.sessionId) ?? 0) + 1;
    this.sequences.set(input.sessionId, sequence);
    const receipt = buildRawReceipt(input, classifyInputSource(input.source, input.trustedRpc === true), sequence);
    this.receipts.set(receipt.operationId, receipt);
    const queue = this.pending.get(input.sessionId) ?? [];
    queue.push(receipt.operationId);
    this.pending.set(input.sessionId, queue);
    return receipt;
  }

  link(operationId: string, message: ExpandedHostMessage): LinkedInputReceipt {
    const raw = this.receipts.get(operationId);
    if (!raw) {
      throw Object.assign(new Error("PCR_INPUT_NOT_FOUND"), { code: "PCR_INPUT_NOT_FOUND" });
    }
    const queue = this.pending.get(raw.sessionId) ?? [];
    if (queue[0] !== operationId) {
      throw Object.assign(new Error("PCR_INPUT_CROSS_LINK"), { code: "PCR_INPUT_CROSS_LINK" });
    }
    queue.shift();
    const linked: LinkedInputReceipt = {
      ...raw,
      hostMessageId: message.hostMessageId,
      expandedText: message.expandedText,
    };
    this.linked.set(operationId, linked);
    return linked;
  }

  linkNext(sessionId: string, message: ExpandedHostMessage): LinkedInputReceipt | undefined {
    const operationId = this.pending.get(sessionId)?.[0];
    if (!operationId) return undefined;
    return this.link(operationId, message);
  }

  latestLinked(sessionId: string): LinkedInputReceipt | undefined {
    let latest: LinkedInputReceipt | undefined;
    for (const item of this.linked.values()) {
      if (item.sessionId !== sessionId) continue;
      if (!latest || item.sequence > latest.sequence) latest = item;
    }
    return latest;
  }

  expireOrphans(now: number, ttl: number): RawInputReceipt[] {
    const expired: RawInputReceipt[] = [];
    for (const receipt of this.receipts.values()) {
      if (this.linked.has(receipt.operationId)) continue;
      if (now - receipt.at < ttl) continue;
      receipt.expired = true;
      expired.push(receipt);
    }
    return expired;
  }

  get(operationId: string): RawInputReceipt | LinkedInputReceipt | undefined {
    return this.linked.get(operationId) ?? this.receipts.get(operationId);
  }
}
