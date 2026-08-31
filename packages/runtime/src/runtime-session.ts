import type { MaterializedView } from "@pcr/contracts";

import type {
  BranchChangedEvent,
  CompactionAckInput,
  CompactionPrepareInput,
  ExactReadRequest,
  MaterializationRequest,
  ProjectedToolResult,
  RecoverRequest,
  RuntimeSession,
  RuntimeSessionPorts,
  RuntimeSessionScope,
  SearchRequest,
  SessionCompactionDecision,
  SessionExactPage,
  RecoverSessionReport,
  SessionSearchHit,
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
  #closed = false;
  #writeChain: Promise<void> = Promise.resolve();
  #reads = 0;
  #readIdle = Promise.resolve();
  #notifyReadsIdle: (() => void) | undefined;

  constructor(input: RuntimeSessionDependencies) {
    const dependencies = validateDependencies(input);
    this.scope = dependencies.scope;
    this.#ports = dependencies.ports;
  }

  async ingestUserInput(input: UserInputEvent): Promise<UserInputReceipt> {
    return this.#mutate(input, () => this.#ports.userInput.capture(input));
  }

  async ingestToolResult(input: ToolObservation): Promise<ProjectedToolResult> {
    return this.#mutate(input, () => this.#ports.toolResult.ingest(input));
  }

  async materialize(input: MaterializationRequest): Promise<MaterializedView> {
    return this.#mutate(input, () => this.#ports.materialization.materialize(input));
  }

  async prepareCompaction(input: CompactionPrepareInput): Promise<SessionCompactionDecision> {
    return this.#mutate(input, () => {
      assertFunction(this.#ports.compaction?.prepare, "ports.compaction.prepare");
      return this.#ports.compaction!.prepare(input);
    });
  }

  async acknowledgeCompaction(input: CompactionAckInput): Promise<void> {
    return this.#mutate(input, async () => {
      const acknowledge = this.#ports.compaction?.acknowledge;
      assertFunction(acknowledge ?? this.#ports.compaction?.prepare, "ports.compaction.acknowledge");
      if (typeof acknowledge === "function") await acknowledge(input);
    });
  }

  async search(input: SearchRequest): Promise<SessionSearchHit[]> {
    return this.#read(input, () => {
      assertFunction(this.#ports.retrieval?.search, "ports.retrieval.search");
      return this.#ports.retrieval!.search(input);
    });
  }

  async read(input: ExactReadRequest): Promise<SessionExactPage> {
    return this.#read(input, () => {
      assertFunction(this.#ports.retrieval?.read, "ports.retrieval.read");
      return this.#ports.retrieval!.read(input);
    });
  }

  async branchChanged(event: BranchChangedEvent): Promise<void> {
    return this.#mutate(event, () => {
      assertFunction(this.#ports.recovery?.branchChanged, "ports.recovery.branchChanged");
      return this.#ports.recovery!.branchChanged(event);
    });
  }

  async recover(reason: RecoverRequest): Promise<RecoverSessionReport> {
    return this.#mutate(reason, () => {
      assertFunction(this.#ports.recovery?.recover, "ports.recovery.recover");
      return this.#ports.recovery!.recover(reason);
    });
  }

  async close(): Promise<void> {
    await this.#exclusive(async () => {
      this.#closed = true;
    });
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new RuntimeSessionError("PCR_RUNTIME_SESSION_CLOSED");
    }
  }

  #validate(input: { operationId: string; cursor: RuntimeSessionScope; signal?: AbortSignal }): void {
    this.#assertOpen();
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

  async #exclusive<T>(work: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.#writeChain;
    this.#writeChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    while (this.#reads > 0) await this.#readIdle;
    try {
      return await work();
    } finally {
      release();
    }
  }

  async #mutate<T>(
    input: { operationId: string; cursor: RuntimeSessionScope; signal?: AbortSignal },
    work: () => Promise<T>,
  ): Promise<T> {
    return this.#exclusive(async () => {
      this.#validate(input);
      return work();
    });
  }

  async #read<T>(
    input: { operationId: string; cursor: RuntimeSessionScope; signal?: AbortSignal },
    work: () => Promise<T>,
  ): Promise<T> {
    await this.#writeChain;
    this.#validate(input);
    if (this.#reads === 0) {
      this.#readIdle = new Promise<void>((resolve) => {
        this.#notifyReadsIdle = resolve;
      });
    }
    this.#reads += 1;
    try {
      return await work();
    } finally {
      this.#reads -= 1;
      if (this.#reads === 0) {
        this.#notifyReadsIdle?.();
        this.#notifyReadsIdle = undefined;
        this.#readIdle = Promise.resolve();
      }
    }
  }
}

export function createRuntimeSession(input: RuntimeSessionDependencies): RuntimeSessionApplicationService {
  return new RuntimeSessionApplicationService(input);
}
