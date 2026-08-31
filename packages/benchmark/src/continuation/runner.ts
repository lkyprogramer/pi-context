import { createHash } from "node:crypto";

export interface ToolCallRecord {
  toolName: string;
  args: unknown;
}

export interface ContinuationAssertion {
  kind: "file_sha256" | "forbidden_command" | "command_exit";
  path?: string;
  expected?: string | number;
  pattern?: string;
}

export interface AssertionResult {
  kind: ContinuationAssertion["kind"];
  path?: string;
  ok: boolean;
}

export interface ContinuationResult {
  assertions: readonly AssertionResult[];
  toolCalls: readonly ToolCallRecord[];
  finalWorkspaceHash: string;
  success: boolean;
}

export interface ContinuationWorkspace {
  restore(snapshot: Record<string, string>, signal?: AbortSignal): Promise<void>;
  apply(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<void>;
  read(path: string): Promise<string | null>;
  hash(): Promise<string>;
}

export interface ContinuationExecutor {
  run(input: { caseId: string; workspaceId: string; snapshot: Record<string, string>; signal?: AbortSignal }): Promise<{
    toolCalls: readonly ToolCallRecord[];
    commandExits?: Readonly<Record<string, number>>;
  }>;
}

export interface ContinuationRunner {
  run(input: {
    caseId: string;
    workspaceId: string;
    snapshot: Record<string, string>;
    assertions: readonly ContinuationAssertion[];
    expectedWorkspaceId?: string;
    signal?: AbortSignal;
  }): Promise<ContinuationResult>;
}

export interface CreateContinuationRunnerInput {
  corpusId: string;
  workspace: ContinuationWorkspace;
  executor: ContinuationExecutor;
}

export type ContinuationErrorCode =
  | "PCR_CONTINUATION_DEPENDENCY_MISSING"
  | "PCR_CONTINUATION_INPUT_INVALID"
  | "PCR_CONTINUATION_SCOPE_MISMATCH";

export class ContinuationError extends TypeError {
  readonly code: ContinuationErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ContinuationErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "ContinuationError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new ContinuationError("PCR_CONTINUATION_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new ContinuationError("PCR_CONTINUATION_INPUT_INVALID", { field });
}

function failScope(details: Record<string, unknown> = {}): never {
  throw new ContinuationError("PCR_CONTINUATION_SCOPE_MISMATCH", details);
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function createContinuationRunner(input: CreateContinuationRunnerInput): ContinuationRunner {
  if (!input || typeof input !== "object") failMissing("input");
  if (typeof input.corpusId !== "string" || input.corpusId.length === 0) failMissing("corpusId");
  if (!input.workspace || typeof input.workspace !== "object") failMissing("workspace");
  if (typeof input.workspace.restore !== "function") failMissing("workspace.restore");
  if (typeof input.workspace.apply !== "function") failMissing("workspace.apply");
  if (typeof input.workspace.read !== "function") failMissing("workspace.read");
  if (typeof input.workspace.hash !== "function") failMissing("workspace.hash");
  if (!input.executor || typeof input.executor.run !== "function") failMissing("executor");
  const workspace = input.workspace;
  const executor = input.executor;
  return {
    async run(request): Promise<ContinuationResult> {
      if (!request || typeof request !== "object") failInput("request");
      if (typeof request.caseId !== "string" || request.caseId.length === 0) failInput("caseId");
      if (typeof request.workspaceId !== "string" || request.workspaceId.length === 0) failInput("workspaceId");
      if (!request.snapshot || typeof request.snapshot !== "object" || Array.isArray(request.snapshot)) failInput("snapshot");
      if (!Array.isArray(request.assertions)) failInput("assertions");
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failInput("signal");
      if (request.expectedWorkspaceId && request.expectedWorkspaceId !== request.workspaceId) {
        failScope({ expected: request.expectedWorkspaceId, actual: request.workspaceId });
      }
      request.signal?.throwIfAborted();
      await workspace.restore(request.snapshot, request.signal);
      request.signal?.throwIfAborted();
      const executed = await executor.run({
        caseId: request.caseId,
        workspaceId: request.workspaceId,
        snapshot: request.snapshot,
        signal: request.signal,
      });
      if (!executed || !Array.isArray(executed.toolCalls)) failInput("executor.toolCalls");
      const toolCalls = executed.toolCalls.map((call, index) => {
        if (!call || typeof call.toolName !== "string" || call.toolName.length === 0) failInput(`toolCalls[${index}].toolName`);
        return { toolName: call.toolName, args: call.args };
      });
      for (const call of toolCalls) {
        request.signal?.throwIfAborted();
        await workspace.apply(call.toolName, (call.args ?? {}) as Record<string, unknown>, request.signal);
      }
      const assertions: AssertionResult[] = [];
      for (const assertion of request.assertions) {
        if (!assertion || typeof assertion !== "object") failInput("assertions[]");
        if (assertion.kind === "file_sha256") {
          if (typeof assertion.path !== "string" || assertion.path.length === 0) failInput("assertions.path");
          if (typeof assertion.expected !== "string") failInput("assertions.expected");
          const body = await workspace.read(assertion.path);
          assertions.push({
            kind: "file_sha256",
            path: assertion.path,
            ok: body !== null && sha256(body) === assertion.expected,
          });
          continue;
        }
        if (assertion.kind === "forbidden_command") {
          if (typeof assertion.pattern !== "string" || assertion.pattern.length === 0) failInput("assertions.pattern");
          const hit = toolCalls.some((call) => JSON.stringify(call).includes(assertion.pattern ?? ""));
          assertions.push({ kind: "forbidden_command", ok: !hit });
          continue;
        }
        if (assertion.kind === "command_exit") {
          if (typeof assertion.pattern !== "string" || assertion.pattern.length === 0) failInput("assertions.pattern");
          if (typeof assertion.expected !== "number") failInput("assertions.expected");
          const exit = executed.commandExits?.[assertion.pattern];
          assertions.push({ kind: "command_exit", ok: exit === assertion.expected });
          continue;
        }
        failInput("assertions.kind");
      }
      const finalWorkspaceHash = await workspace.hash();
      if (typeof finalWorkspaceHash !== "string" || !/^[a-f0-9]{64}$/u.test(finalWorkspaceHash)) failInput("workspace.hash");
      return Object.freeze({
        assertions: Object.freeze(assertions),
        toolCalls: Object.freeze(toolCalls),
        finalWorkspaceHash,
        success: assertions.every((row) => row.ok),
      });
    },
  };
}
