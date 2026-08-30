import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import type { RuntimeCursor } from "../../../packages/contracts/src/index.js";
import { createRuntimeCursor } from "../../../packages/core/src/index.js";
import {
  registerToolResultHook,
  registerUserInputHook,
  type RegisteredUserInputHook,
} from "../../../packages/pi-adapter/src/index.js";
import {
  createObservationService,
  createUserTurnService,
  createRuntimeSession,
  createRuntimeSessionRegistry,
  RuntimeSessionRegistryError,
  type DurableSagaJournal,
  type ObservationService,
  type PiSessionContext,
  type RuntimeSession,
  type RuntimeSessionPorts,
  type RuntimeSessionRegistry,
  type UserTurnService,
} from "../../../packages/runtime/src/index.js";
import {
  createEncryptedBlobStore,
  openLocalWorkspaceBlobKeyProvider,
  openWorkspaceSagaJournal,
  openWorkspaceSqliteStore,
  openWorkspaceUserTurnLedger,
  type LocalWorkspaceBlobKeyProvider,
  type WorkspaceSqliteEvidenceStore,
} from "../../../packages/storage-node/src/index.js";
import { claimPiContextOwner } from "./owner.js";

export type PiRuntimeContext = Pick<ExtensionContext, "cwd" | "model" | "sessionManager" | "signal">;

export interface ProductionSessionResources {
  ports: RuntimeSessionPorts;
  dispose(): Promise<void>;
}

export interface ProductionSessionResourcesFactory {
  create(ctx: Readonly<PiSessionContext>): Promise<ProductionSessionResources>;
}

export interface ProductionSessionIdentityInput {
  workspacePath: string;
  sessionId: string;
  leafId: string | null;
  lineageEntryIds: readonly string[];
  modelKey: string;
}

export interface ProductionSessionIdentityFactory {
  create(input: ProductionSessionIdentityInput): Omit<PiSessionContext, "signal">;
}

export interface ProductionCompositionRootDependencies {
  identity: ProductionSessionIdentityFactory;
  resources: ProductionSessionResourcesFactory;
}

export interface ProductionCompositionRoot {
  open(ctx: PiRuntimeContext): Promise<RuntimeSession>;
  get(sessionId: string): RuntimeSession;
  close(ctx: Pick<PiRuntimeContext, "sessionManager">): Promise<void>;
}

export interface ProductionPiContextExtension {
  name: "pi-context-runtime";
  claimed: true;
  release(): void;
}

export type ProductionCompositionErrorCode =
  | "PCR_PRODUCTION_DEPENDENCY_MISSING"
  | "PCR_PI_SESSION_CONTEXT_INVALID"
  | "PCR_PI_SESSION_SCOPE_CONFLICT";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export class ProductionCompositionError extends TypeError {
  readonly code: ProductionCompositionErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ProductionCompositionErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "ProductionCompositionError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProductionCompositionError("PCR_PI_SESSION_CONTEXT_INVALID", { field });
  }
}

function modelKey(ctx: PiRuntimeContext): string {
  if (!ctx.model) {
    throw new ProductionCompositionError("PCR_PI_SESSION_CONTEXT_INVALID", { field: "model" });
  }
  requireNonEmpty(ctx.model.provider, "model.provider");
  requireNonEmpty(ctx.model.id, "model.id");
  return `${ctx.model.provider}/${ctx.model.id}`;
}

export function derivePiSessionContext(
  ctx: PiRuntimeContext,
  identity: ProductionSessionIdentityFactory,
): PiSessionContext {
  if (!ctx || typeof ctx !== "object") {
    throw new ProductionCompositionError("PCR_PI_SESSION_CONTEXT_INVALID", { field: "context" });
  }
  requireNonEmpty(ctx.cwd, "cwd");
  const sessionId = ctx.sessionManager?.getSessionId();
  requireNonEmpty(sessionId, "sessionManager.sessionId");
  const leafId = ctx.sessionManager.getLeafId();
  if (leafId !== null) requireNonEmpty(leafId, "sessionManager.leafId");
  const branchIds = ctx.sessionManager.getBranch().map((entry) => entry.id);
  const headerId = ctx.sessionManager.getHeader()?.id;
  // Pi has no branch entries at session_start; its persisted session header is the real root anchor.
  const lineageEntryIds = branchIds.length > 0 ? branchIds : headerId ? [headerId] : [];
  if (lineageEntryIds.length === 0) {
    throw new ProductionCompositionError("PCR_PI_SESSION_CONTEXT_INVALID", {
      field: "sessionManager.lineage",
    });
  }
  if (!identity || typeof identity.create !== "function") {
    throw new ProductionCompositionError("PCR_PRODUCTION_DEPENDENCY_MISSING", {
      dependency: "identity.create",
    });
  }
  const identityInput = {
    workspacePath: ctx.cwd,
    sessionId,
    leafId,
    lineageEntryIds,
    modelKey: modelKey(ctx),
  };
  const cursor = identity.create(identityInput);
  if (
    !cursor ||
    typeof cursor.workspaceId !== "string" ||
    cursor.workspaceId.length === 0 ||
    cursor.sessionId !== identityInput.sessionId ||
    cursor.leafId !== identityInput.leafId ||
    cursor.modelKey !== identityInput.modelKey ||
    typeof cursor.lineageHash !== "string" ||
    !SHA256_PATTERN.test(cursor.lineageHash)
  ) {
    throw new ProductionCompositionError("PCR_PI_SESSION_CONTEXT_INVALID", {
      field: "identity.result",
    });
  }
  return Object.freeze({ ...cursor, signal: ctx.signal });
}

function validateResources(value: ProductionSessionResources): ProductionSessionResources {
  if (!value || typeof value !== "object") {
    throw new ProductionCompositionError("PCR_PRODUCTION_DEPENDENCY_MISSING", {
      dependency: "resources.create.result",
    });
  }
  if (typeof value.dispose !== "function") {
    throw new ProductionCompositionError("PCR_PRODUCTION_DEPENDENCY_MISSING", {
      dependency: "resources.create.result.dispose",
    });
  }
  return value;
}

export class ProductionRuntimeCompositionRoot implements ProductionCompositionRoot {
  readonly #identity: ProductionSessionIdentityFactory;
  readonly #resources: ProductionSessionResourcesFactory;
  #workspaceId: string | undefined;
  #workspaceRegistry: RuntimeSessionRegistry | undefined;

  constructor(dependencies: ProductionCompositionRootDependencies) {
    if (!dependencies?.identity || typeof dependencies.identity.create !== "function") {
      throw new ProductionCompositionError("PCR_PRODUCTION_DEPENDENCY_MISSING", {
        dependency: "identity.create",
      });
    }
    if (!dependencies?.resources || typeof dependencies.resources.create !== "function") {
      throw new ProductionCompositionError("PCR_PRODUCTION_DEPENDENCY_MISSING", {
        dependency: "resources.create",
      });
    }
    this.#identity = dependencies.identity;
    this.#resources = dependencies.resources;
  }

  async open(hostContext: PiRuntimeContext): Promise<RuntimeSession> {
    const context = derivePiSessionContext(hostContext, this.#identity);
    return this.#registry(context.workspaceId).open(context);
  }

  get(sessionId: string): RuntimeSession {
    if (!this.#workspaceRegistry) {
      throw new RuntimeSessionRegistryError("PCR_RUNTIME_SESSION_NOT_OPEN", { sessionId });
    }
    return this.#workspaceRegistry.get(sessionId);
  }

  async close(hostContext: Pick<PiRuntimeContext, "sessionManager">): Promise<void> {
    const sessionId = hostContext.sessionManager?.getSessionId();
    requireNonEmpty(sessionId, "sessionManager.sessionId");
    await this.#workspaceRegistry?.close(sessionId);
  }

  #registry(workspaceId: string): RuntimeSessionRegistry {
    if (this.#workspaceRegistry) {
      if (this.#workspaceId !== workspaceId) {
        throw new ProductionCompositionError("PCR_PI_SESSION_SCOPE_CONFLICT", {
          expectedWorkspaceId: this.#workspaceId,
          actualWorkspaceId: workspaceId,
        });
      }
      return this.#workspaceRegistry;
    }
    this.#workspaceId = workspaceId;
    this.#workspaceRegistry = createRuntimeSessionRegistry({
      workspaceId,
      factory: {
        create: async (context) => {
          const resources = validateResources(await this.#resources.create(context));
          try {
            const session = createRuntimeSession({ scope: context, ports: resources.ports });
            return { session, dispose: () => resources.dispose() };
          } catch (error) {
            await resources.dispose().catch(() => undefined);
            throw error;
          }
        },
      },
    });
    return this.#workspaceRegistry;
  }
}

export function createProductionCompositionRoot(
  dependencies: ProductionCompositionRootDependencies,
): ProductionRuntimeCompositionRoot {
  return new ProductionRuntimeCompositionRoot(dependencies);
}

export function registerProductionSessionLifecycle(
  pi: Pick<ExtensionAPI, "on">,
  root: ProductionCompositionRoot,
): void {
  pi.on("session_start", async (_event, ctx) => {
    await root.open(ctx);
  });
  pi.on("session_tree", async (_event, ctx) => {
    await root.open(ctx);
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    await root.close(ctx);
  });
}

/** Explicit production entry. It registers only session lifecycle backed by injected real resources. */
export function createProductionPiContextExtension(
  pi: ExtensionAPI,
  dependencies: ProductionCompositionRootDependencies,
): ProductionPiContextExtension {
  const root = createProductionCompositionRoot(dependencies);
  const owner = claimPiContextOwner("pi-context-runtime");
  try {
    registerProductionSessionLifecycle(pi, root);
  } catch (error) {
    owner.release();
    throw error;
  }
  return { name: "pi-context-runtime", claimed: true, release: owner.release };
}

export interface ProductionUserTurnRuntimeOptions {
  identity?: ProductionSessionIdentityFactory;
  dataRoot?(ctx: ExtensionContext): string;
  environment?: Readonly<Record<string, string | undefined>>;
  clock?: { now(): number };
  busyTimeoutMs?: number;
  maxBlobBytes?: number;
  onHardFailure?(error: unknown, phase: string, ctx: ExtensionContext): void | Promise<void>;
}

export interface ProductionUserTurnRuntime {
  readonly hook: RegisteredUserInputHook;
  close(): Promise<void>;
}

interface WorkspaceUserTurnOwner {
  readonly dataRoot: string;
  readonly database: WorkspaceSqliteEvidenceStore;
  readonly keys: LocalWorkspaceBlobKeyProvider;
  readonly services: Map<string, UserTurnService>;
  readonly observations: Map<string, ObservationService>;
  service(cursor: RuntimeCursor): UserTurnService;
  observation(cursor: RuntimeCursor): ObservationService;
  close(): Promise<void>;
}

function cursorKey(cursor: RuntimeCursor): string {
  return JSON.stringify([
    cursor.workspaceId,
    cursor.sessionId,
    cursor.leafId,
    cursor.lineageHash,
    cursor.modelKey,
  ]);
}

/** Register the durable T12 ingress path on the same Pi extension entry that owns lifecycle hooks. */
export function registerProductionUserTurnRuntime(
  pi: ExtensionAPI,
  options: ProductionUserTurnRuntimeOptions = {},
): ProductionUserTurnRuntime {
  const identity = options.identity ?? { create: createRuntimeCursor };
  const clock = options.clock ?? { now: Date.now };
  const owners = new Map<string, Promise<WorkspaceUserTurnOwner>>();

  const cursorFromContext = (ctx: ExtensionContext): RuntimeCursor => {
    const derived = derivePiSessionContext(ctx, identity);
    return Object.freeze({
      workspaceId: derived.workspaceId,
      sessionId: derived.sessionId,
      leafId: derived.leafId,
      lineageHash: derived.lineageHash,
      modelKey: derived.modelKey,
    });
  };

  const ownerFor = async (cursor: RuntimeCursor, ctx: ExtensionContext): Promise<WorkspaceUserTurnOwner> => {
    const dataRoot = options.dataRoot?.(ctx)
      ?? join(ctx.sessionManager.getSessionDir(), ".context-runtime");
    const existing = owners.get(cursor.workspaceId);
    if (existing) {
      const owner = await existing;
      if (owner.dataRoot !== dataRoot) {
        throw new ProductionCompositionError("PCR_PI_SESSION_SCOPE_CONFLICT", {
          expectedDataRoot: owner.dataRoot,
          actualDataRoot: dataRoot,
        });
      }
      return owner;
    }
    const opening = (async (): Promise<WorkspaceUserTurnOwner> => {
      const database = await openWorkspaceSqliteStore({
        dataRoot,
        workspaceId: cursor.workspaceId,
        busyTimeoutMs: options.busyTimeoutMs ?? 1_000,
        ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
      });
      let keys: LocalWorkspaceBlobKeyProvider | undefined;
      try {
        keys = openLocalWorkspaceBlobKeyProvider({
          dataRoot,
          workspaceId: cursor.workspaceId,
          ...(options.environment === undefined ? {} : { environment: options.environment }),
        });
        const blobs = createEncryptedBlobStore({
          dataRoot,
          workspaceId: cursor.workspaceId,
          maxBlobBytes: options.maxBlobBytes ?? 8 * 1024 * 1024,
          keys,
        });
        const ledger = await openWorkspaceUserTurnLedger({ database });
        const saga: DurableSagaJournal = await openWorkspaceSagaJournal({
          database,
          async verifyBlob(scope, ref) { await blobs.read(scope, ref, { start: 0, endExclusive: 0 }); },
        });
        const services = new Map<string, UserTurnService>();
        const observations = new Map<string, ObservationService>();
        return {
          dataRoot,
          database,
          keys,
          services,
          observations,
          service(candidate) {
            const key = cursorKey(candidate);
            let service = services.get(key);
            if (!service) {
              service = createUserTurnService({ cursor: candidate, blobs, ledger });
              services.set(key, service);
            }
            return service;
          },
          observation(candidate) {
            const key = cursorKey(candidate);
            let service = observations.get(key);
            if (!service) {
              service = createObservationService({ cursor: candidate, blobs, saga });
              observations.set(key, service);
            }
            return service;
          },
          async close() {
            services.clear();
            observations.clear();
            try {
              await saga.close();
              await ledger.close();
              await database.close();
            } finally {
              keys!.close();
            }
          },
        };
      } catch (error) {
        keys?.close();
        await database.close().catch(() => undefined);
        throw error;
      }
    })();
    owners.set(cursor.workspaceId, opening);
    try {
      return await opening;
    } catch (error) {
      if (owners.get(cursor.workspaceId) === opening) owners.delete(cursor.workspaceId);
      throw error;
    }
  };

  const hook = registerUserInputHook(pi, {
    cursor: cursorFromContext,
    async service(cursor, ctx) {
      return (await ownerFor(cursor, ctx)).service(cursor);
    },
    clock,
    async onHardFailure(error, phase, ctx) {
      await options.onHardFailure?.(error, phase, ctx);
    },
  });
  registerToolResultHook(pi, {
    cursor: cursorFromContext,
    async service(cursor, ctx) {
      return (await ownerFor(cursor, ctx)).observation(cursor);
    },
    clock,
    async onHardFailure(error, phase, ctx) {
      await options.onHardFailure?.(error, phase, ctx);
    },
  });

  const close = async (): Promise<void> => {
    const pending = [...owners.values()];
    owners.clear();
    const settled = await Promise.allSettled(pending.map(async (owner) => (await owner).close()));
    const rejected = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (rejected) throw rejected.reason;
  };
  pi.on("session_shutdown", async () => close());
  return Object.freeze({ hook, close });
}
