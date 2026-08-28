import { domainHash, type ActionAuthority } from "../../../contracts/src/index.js";
import { effectiveToolClass, hasEgressArgs, type ToolClass } from "./tool-taxonomy.js";
import { attestOutcome } from "./outcome-attestation.js";

export interface ProposedToolCall {
  toolName: string;
  args: unknown;
  priorQuery?: string;
}

export interface ActionDependency {
  ref: string;
  authority: ActionAuthority;
}

export interface ActionGatePolicy {
  allowHumanApproval: boolean;
  now?: number;
  approvalTtlMs?: number;
}

export interface ActionGateDeps {
  taxonomy: { classify(toolName: string): ToolClass };
  resolveDependencies(call: ProposedToolCall): Promise<ActionDependency[]>;
  policy: ActionGatePolicy;
  recentMemoryRead?: boolean;
}

export type ActionDecision =
  | { kind: "allow"; reason: string }
  | { kind: "deny"; code: "PCR_ACTION_AUTHORITY_MISSING"; dependencies?: ActionDependency[] }
  | {
      kind: "approval-required";
      dependencies: ActionDependency[];
      approvalId: string;
      expiresAt: number;
      boundToolName: string;
      boundArgsHash: string;
    };

export interface BlockedToolResult {
  isError: true;
  code: "PCR_ACTION_AUTHORITY_MISSING";
  text: string;
}

export interface ToolCallGateHost {
  on(hook: string, handler: (event: { content?: unknown }) => unknown): void;
}

export interface ToolCallGateOptions {
  authorize: (call: ProposedToolCall) => Promise<ActionDecision>;
  onBlocked?: (result: BlockedToolResult) => void;
}

const SECRET_LIKE = /-----BEGIN|api[_-]?key|secret|token=|[A-Za-z0-9+/]{40,}={0,2}/i;

export function blockedToolResult(): BlockedToolResult {
  return {
    isError: true,
    code: "PCR_ACTION_AUTHORITY_MISSING",
    text: "PCR_ACTION_AUTHORITY_MISSING",
  };
}

export function approvalBinding(call: ProposedToolCall): { approvalId: string; boundArgsHash: string } {
  const boundArgsHash = domainHash("action-approval-args", call.args ?? null);
  return { approvalId: `ap_${domainHash("action-approval", { toolName: call.toolName, boundArgsHash })}`, boundArgsHash };
}

export function approvalMatches(decision: Extract<ActionDecision, { kind: "approval-required" }>, call: ProposedToolCall, now: number): boolean {
  if (now >= decision.expiresAt) return false;
  if (decision.boundToolName !== call.toolName) return false;
  return decision.boundArgsHash === domainHash("action-approval-args", call.args ?? null);
}

export async function authorizeToolCall(call: ProposedToolCall, deps: ActionGateDeps): Promise<ActionDecision> {
  const classification = deps.taxonomy.classify(call.toolName);
  const effective = classification === "query" ? "query" : effectiveToolClass(call.toolName);
  const dependencies = await deps.resolveDependencies(call);
  const memoryThenEgress =
    Boolean(deps.recentMemoryRead || call.priorQuery === "memory-read") &&
    (effective === "command" || hasEgressArgs(call.args) || /curl|fetch|network|deploy/.test(call.toolName));
  if (effective === "query" && !hasEgressArgs(call.args) && !SECRET_LIKE.test(JSON.stringify(call.args ?? {}))) {
    return { kind: "allow", reason: "read-only" };
  }
  if (memoryThenEgress && dependencies.some((item) => item.authority !== "act")) {
    if (deps.policy.allowHumanApproval) {
      return approvalDecision(call, dependencies, deps.policy);
    }
    return { kind: "deny", code: "PCR_ACTION_AUTHORITY_MISSING", dependencies };
  }
  if (dependencies.every((item) => item.authority === "act") && dependencies.length > 0) {
    return { kind: "allow", reason: "act-authorized" };
  }
  if (deps.policy.allowHumanApproval) return approvalDecision(call, dependencies, deps.policy);
  return { kind: "deny", code: "PCR_ACTION_AUTHORITY_MISSING", dependencies };
}

export function attestAndGate(
  assistantClaim: string | undefined,
  tool: { isError: boolean; exitCode?: number; text?: string },
): boolean {
  return attestOutcome({ assistantClaim, tool }).attested;
}

function approvalDecision(call: ProposedToolCall, dependencies: ActionDependency[], policy: ActionGatePolicy) {
  const now = policy.now ?? 0;
  const ttl = policy.approvalTtlMs ?? 60_000;
  const binding = approvalBinding(call);
  return {
    kind: "approval-required" as const,
    dependencies,
    approvalId: binding.approvalId,
    expiresAt: now + ttl,
    boundToolName: call.toolName,
    boundArgsHash: binding.boundArgsHash,
  };
}

export function bindToolCallGate(host: ToolCallGateHost, options: ToolCallGateOptions): void {
  host.on("tool_call", async (event) => {
    const content = event.content && typeof event.content === "object" ? (event.content as ProposedToolCall) : { toolName: "unknown", args: {} };
    const decision = await options.authorize(content);
    if (decision.kind === "deny") {
      options.onBlocked?.(blockedToolResult());
    }
  });
}
