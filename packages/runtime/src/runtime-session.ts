import type { MaterializedView } from "@pcr/contracts";

import type {
  MaterializationRequest,
  ProjectedToolResult,
  RuntimeSession,
  RuntimeSessionPorts,
  RuntimeSessionScope,
  ToolObservation,
  UserInputEvent,
  UserInputReceipt,
} from "./ports.js";
import { RuntimeSessionError } from "./ports.js";

export interface RuntimeSessionDependencies {
  scope: RuntimeSessionScope;
  ports: RuntimeSessionPorts;
}

function assertFunction(value: unknown, dependency: string): void {
  if (typeof value !== "function") {
    throw new RuntimeSessionError("PCR_RUNTIME_DEPENDENCY_MISSING", { dependency });
  }
}

function validateScope(scope: RuntimeSessionScope): RuntimeSessionScope {
  if (
    !scope ||
    typeof scope.workspaceId !== "string" ||
    scope.workspaceId.length === 0 ||
    typeof scope.sessionId !== "string" ||
    scope.sessionId.length === 0 ||
    (scope.leafId !== null && (typeof scope.leafId !== "string" || scope.leafId.length === 0)) ||
    typeof scope.lineageHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(scope.lineageHash)
  ) {
    throw new RuntimeSessionError("PCR_RUNTIME_INPUT_INVALID", { field: "scope" });
  }
  return Object.freeze({ ...scope });
}

function validateDependencies(input: RuntimeSessionDependencies): {
  scope: RuntimeSessionScope;
  ports: RuntimeSessionPorts;
} {
  if (!input || typeof input !== "object") {
    throw new RuntimeSessionError("PCR_RUNTIME_DEPENDENCY_MISSING", { dependency: "input" });
  }
  const scope = validateScope(input.scope);
  const ports = input.ports;
  if (!ports || typeof ports !== "object") {
    throw new RuntimeSessionError("PCR_RUNTIME_DEPENDENCY_MISSING", { dependency: "ports" });
  }
  assertFunction(ports.userInput?.capture, "ports.userInput.capture");
  assertFunction(ports.toolResult?.ingest, "ports.toolResult.ingest");
  assertFunction(ports.materialization?.materialize, "ports.materialization.materialize");
  return { scope, ports };
}

function validateOperation(input: { operationId?: unknown; cursor?: unknown; signal?: AbortSignal }): void {
  if (!input || typeof input !== "object") {
    throw new RuntimeSessionError("PCR_RUNTIME_INPUT_INVALID", { field: "input" });
  }
  if (typeof input.operationId !== "string" || input.operationId.length === 0) {
    throw new RuntimeSessionError("PCR_RUNTIME_INPUT_INVALID", { field: "operationId" });
  }
  if (!input.cursor || typeof input.cursor !== "object") {
    throw new RuntimeSessionError("PCR_RUNTIME_INPUT_INVALID", { field: "cursor" });
  }
  input.signal?.throwIfAborted();
}

export class RuntimeSessionApplicationService implements RuntimeSession {
  readonly scope: RuntimeSessionScope;
  #ports: RuntimeSessionPorts;

  constructor(input: RuntimeSessionDependencies) {
    const dependencies = validateDependencies(input);
    this.scope = dependencies.scope;
    this.#ports = dependencies.ports;
  }

  async ingestUserInput(input: UserInputEvent): Promise<UserInputReceipt> {
    this.#validate(input);
    return this.#ports.userInput.capture(input);
  }

  async ingestToolResult(input: ToolObservation): Promise<ProjectedToolResult> {
    this.#validate(input);
    return this.#ports.toolResult.ingest(input);
  }

  async materialize(input: MaterializationRequest): Promise<MaterializedView> {
    this.#validate(input);
    return this.#ports.materialization.materialize(input);
  }

  #validate(input: { operationId: string; cursor: RuntimeSessionScope; signal?: AbortSignal }): void {
    validateOperation(input);
    const cursor = input.cursor;
    const mismatch =
      cursor.workspaceId !== this.scope.workspaceId ||
      cursor.sessionId !== this.scope.sessionId ||
      cursor.leafId !== this.scope.leafId ||
      cursor.lineageHash !== this.scope.lineageHash;
    if (mismatch) {
      throw new RuntimeSessionError("PCR_RUNTIME_SCOPE_MISMATCH", {
        expectedWorkspaceId: this.scope.workspaceId,
        expectedSessionId: this.scope.sessionId,
        expectedLeafId: this.scope.leafId,
        expectedLineageHash: this.scope.lineageHash,
      });
    }
  }
}

export function createRuntimeSession(input: RuntimeSessionDependencies): RuntimeSessionApplicationService {
  return new RuntimeSessionApplicationService(input);
}
