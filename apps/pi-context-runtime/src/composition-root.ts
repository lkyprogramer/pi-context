import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  createRuntimeSession,
  createRuntimeSessionRegistry,
  RuntimeSessionRegistryError,
  type PiSessionContext,
  type RuntimeSession,
  type RuntimeSessionPorts,
  type RuntimeSessionRegistry,
} from "../../../packages/runtime/src/index.js";
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
