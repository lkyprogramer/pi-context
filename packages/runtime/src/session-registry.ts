import type { RuntimeSession, RuntimeSessionScope } from "./ports.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface PiSessionContext extends RuntimeSessionScope {
  modelKey: string;
  signal?: AbortSignal;
}

export interface RuntimeSessionHandle {
  session: RuntimeSession;
  dispose(): Promise<void>;
}

export interface RuntimeSessionFactory {
  create(ctx: Readonly<PiSessionContext>): Promise<RuntimeSessionHandle>;
}

export interface RuntimeSessionRegistry {
  open(ctx: PiSessionContext): Promise<RuntimeSession>;
  get(sessionId: string): RuntimeSession;
  close(sessionId: string): Promise<void>;
}

export interface RuntimeSessionRegistryDependencies {
  workspaceId: string;
  factory: RuntimeSessionFactory;
}

export type RuntimeSessionRegistryErrorCode =
  | "PCR_RUNTIME_REGISTRY_DEPENDENCY_MISSING"
  | "PCR_RUNTIME_SESSION_CONTEXT_INVALID"
  | "PCR_RUNTIME_SESSION_NOT_OPEN"
  | "PCR_RUNTIME_SESSION_OPEN_CANCELLED"
  | "PCR_RUNTIME_SESSION_SCOPE_CONFLICT";

export class RuntimeSessionRegistryError extends TypeError {
  readonly code: RuntimeSessionRegistryErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: RuntimeSessionRegistryErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "RuntimeSessionRegistryError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

interface SessionSlot {
  readonly context: Readonly<PiSessionContext>;
  state: "opening" | "open" | "closing";
  openPromise: Promise<RuntimeSession>;
  handle?: RuntimeSessionHandle;
  disposePromise?: Promise<void>;
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RuntimeSessionRegistryError("PCR_RUNTIME_SESSION_CONTEXT_INVALID", { field });
  }
}

function validateContext(input: PiSessionContext, workspaceId: string): Readonly<PiSessionContext> {
  if (!input || typeof input !== "object") {
    throw new RuntimeSessionRegistryError("PCR_RUNTIME_SESSION_CONTEXT_INVALID", { field: "context" });
  }
  requireNonEmpty(input.workspaceId, "workspaceId");
  requireNonEmpty(input.sessionId, "sessionId");
  if (input.leafId !== null) requireNonEmpty(input.leafId, "leafId");
  requireNonEmpty(input.modelKey, "modelKey");
  if (typeof input.lineageHash !== "string" || !SHA256_PATTERN.test(input.lineageHash)) {
    throw new RuntimeSessionRegistryError("PCR_RUNTIME_SESSION_CONTEXT_INVALID", { field: "lineageHash" });
  }
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) {
    throw new RuntimeSessionRegistryError("PCR_RUNTIME_SESSION_CONTEXT_INVALID", { field: "signal" });
  }
  if (input.workspaceId !== workspaceId) {
    throw new RuntimeSessionRegistryError("PCR_RUNTIME_SESSION_SCOPE_CONFLICT", {
      expectedWorkspaceId: workspaceId,
      actualWorkspaceId: input.workspaceId,
      sessionId: input.sessionId,
    });
  }
  input.signal?.throwIfAborted();
  return Object.freeze({ ...input });
}

function sameScope(left: PiSessionContext, right: PiSessionContext): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.sessionId === right.sessionId &&
    left.leafId === right.leafId &&
    left.lineageHash === right.lineageHash
  );
}

function validateHandle(value: RuntimeSessionHandle): RuntimeSessionHandle {
  if (!value || typeof value !== "object") {
    throw new RuntimeSessionRegistryError("PCR_RUNTIME_REGISTRY_DEPENDENCY_MISSING", {
      dependency: "factory.create.handle",
    });
  }
  const session = value.session;
  if (
    !session ||
    typeof session.ingestUserInput !== "function" ||
    typeof session.ingestToolResult !== "function" ||
    typeof session.materialize !== "function"
  ) {
    throw new RuntimeSessionRegistryError("PCR_RUNTIME_REGISTRY_DEPENDENCY_MISSING", {
      dependency: "factory.create.handle.session",
    });
  }
  if (typeof value.dispose !== "function") {
    throw new RuntimeSessionRegistryError("PCR_RUNTIME_REGISTRY_DEPENDENCY_MISSING", {
      dependency: "factory.create.handle.dispose",
    });
  }
  return value;
}

export class WorkspaceRuntimeSessionRegistry implements RuntimeSessionRegistry {
  readonly #workspaceId: string;
  readonly #factory: RuntimeSessionFactory;
  readonly #slots = new Map<string, SessionSlot>();

  constructor(dependencies: RuntimeSessionRegistryDependencies) {
    if (!dependencies || typeof dependencies !== "object") {
      throw new RuntimeSessionRegistryError("PCR_RUNTIME_REGISTRY_DEPENDENCY_MISSING", {
        dependency: "dependencies",
      });
    }
    if (typeof dependencies.workspaceId !== "string" || dependencies.workspaceId.length === 0) {
      throw new RuntimeSessionRegistryError("PCR_RUNTIME_REGISTRY_DEPENDENCY_MISSING", {
        dependency: "workspaceId",
      });
    }
    if (!dependencies.factory || typeof dependencies.factory.create !== "function") {
      throw new RuntimeSessionRegistryError("PCR_RUNTIME_REGISTRY_DEPENDENCY_MISSING", {
        dependency: "factory.create",
      });
    }
    this.#workspaceId = dependencies.workspaceId;
    this.#factory = dependencies.factory;
  }

  async open(input: PiSessionContext): Promise<RuntimeSession> {
    const context = validateContext(input, this.#workspaceId);
    const current = this.#slots.get(context.sessionId);
    if (current && sameScope(current.context, context)) {
      if (current.state === "open") return current.handle!.session;
      if (current.state === "opening") return current.openPromise;
    }

    const predecessor = current ? this.#dispose(current) : Promise.resolve();
    const slot: SessionSlot = {
      context,
      state: "opening",
      openPromise: Promise.resolve(undefined as never),
    };
    this.#slots.set(context.sessionId, slot);
    slot.openPromise = (async () => {
      await predecessor;
      context.signal?.throwIfAborted();
      const created = await this.#factory.create(context);
      let handle: RuntimeSessionHandle;
      try {
        handle = validateHandle(created);
      } catch (error) {
        if (created && typeof created === "object" && typeof created.dispose === "function") {
          await created.dispose().catch(() => undefined);
        }
        throw error;
      }
      try {
        context.signal?.throwIfAborted();
      } catch (error) {
        await handle.dispose().catch(() => undefined);
        throw error;
      }
      slot.handle = handle;
      if (slot.state === "closing") {
        throw new RuntimeSessionRegistryError("PCR_RUNTIME_SESSION_OPEN_CANCELLED", {
          sessionId: context.sessionId,
        });
      }
      slot.state = "open";
      return handle.session;
    })().catch((error: unknown) => {
      if (this.#slots.get(context.sessionId) === slot) this.#slots.delete(context.sessionId);
      throw error;
    });
    return slot.openPromise;
  }

  get(sessionId: string): RuntimeSession {
    requireNonEmpty(sessionId, "sessionId");
    const slot = this.#slots.get(sessionId);
    if (!slot || slot.state !== "open" || !slot.handle) {
      throw new RuntimeSessionRegistryError("PCR_RUNTIME_SESSION_NOT_OPEN", { sessionId });
    }
    return slot.handle.session;
  }

  async close(sessionId: string): Promise<void> {
    requireNonEmpty(sessionId, "sessionId");
    const slot = this.#slots.get(sessionId);
    if (!slot) return;
    await this.#dispose(slot);
  }

  #dispose(slot: SessionSlot): Promise<void> {
    if (slot.disposePromise) return slot.disposePromise;
    slot.state = "closing";
    slot.disposePromise = (async () => {
      try {
        await slot.openPromise.catch(() => undefined);
        await slot.handle?.dispose();
      } finally {
        if (this.#slots.get(slot.context.sessionId) === slot) {
          this.#slots.delete(slot.context.sessionId);
        }
      }
    })();
    return slot.disposePromise;
  }
}

export function createRuntimeSessionRegistry(
  dependencies: RuntimeSessionRegistryDependencies,
): WorkspaceRuntimeSessionRegistry {
  return new WorkspaceRuntimeSessionRegistry(dependencies);
}
