import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join, resolve } from "node:path";
import { domainHash, type HostMessage, type RuntimeCursor } from "../../../packages/contracts/src/index.js";
import {
  createCacheReceipt,
  createCheckpointRenderer,
  createCheckpointVerifier,
  createClauseSegmenter,
  createDirectiveExtractor,
  createDirectiveResolver,
  createMaterializer,
  createProductionReducers,
  createReducerRegistry,
  createRuntimeCursor,
  createSectionPlanner,
  createTokenPricer,
  emptyContinuityRevision,
  reservesFromPayload,
  type CacheReceiptRecord,
  type ContinuityRevision,
} from "../../../packages/core/src/index.js";
import {
  registerToolResultHook,
  registerUserInputHook,
  type RegisteredUserInputHook,
} from "../../../packages/pi-adapter/src/index.js";
import {
  assembleRuntimeSnapshot,
  createCompactionService,
  createCompactionSnapshotAssembler,
  createEvidenceService,
  createPointerCheck,
  createObservationService,
  createRecoveryService,
  createRuntimeSession,
  createRuntimeSessionRegistry,
  createUserTurnService,
  RuntimeSessionRegistryError,
  type BranchChange,
  type CandidateRepository,
  type CompactionClaim,
  type DurableSagaJournal,
  type EvidenceFact,
  type EvidenceService,
  type ObservationService,
  type PiSessionContext,
  type ProjectedToolResult,
  type RuntimeSession,
  type RuntimeSessionPorts,
  type RuntimeSessionRegistry,
  type SessionRecoveryReport,
  type SessionStart,
  type ToolObservation,
  type UserTurnService,
} from "../../../packages/runtime/src/index.js";
import {
  createEncryptedBlobStore,
  openLocalWorkspaceBlobKeyProvider,
  openWorkspaceCandidateRepository,
  openWorkspaceEvidenceFtsIndex,
  openWorkspaceEvidenceRepository,
  openWorkspaceSagaJournal,
  openWorkspaceSqliteStore,
  openWorkspaceStateStore,
  openWorkspaceUserTurnLedger,
  type EncryptedBlobStore,
  type LocalWorkspaceBlobKeyProvider,
  type WorkspaceSqliteEvidenceStore,
  type WorkspaceStateStore,
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
  readonly #registries = new Map<string, RuntimeSessionRegistry>();

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
    for (const registry of this.#registries.values()) {
      try {
        return registry.get(sessionId);
      } catch (error) {
        if (error instanceof RuntimeSessionRegistryError && error.code === "PCR_RUNTIME_SESSION_NOT_OPEN") {
          continue;
        }
        throw error;
      }
    }
    throw new RuntimeSessionRegistryError("PCR_RUNTIME_SESSION_NOT_OPEN", { sessionId });
  }

  async close(hostContext: Pick<PiRuntimeContext, "sessionManager">): Promise<void> {
    const sessionId = hostContext.sessionManager?.getSessionId();
    requireNonEmpty(sessionId, "sessionManager.sessionId");
    await Promise.all([...this.#registries.values()].map((registry) => registry.close(sessionId)));
  }

  #registry(workspaceId: string): RuntimeSessionRegistry {
    const existing = this.#registries.get(workspaceId);
    if (existing) return existing;
    const registry = createRuntimeSessionRegistry({
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
    this.#registries.set(workspaceId, registry);
    return registry;
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
  lastWorkspaceId(): string | undefined;
  lastPointers(): ReadonlyArray<{ ref: string; kind: string }>;
  ensure(ctx: ExtensionContext): Promise<void>;
  openSession(ctx: PiSessionContext): Promise<RuntimeSession>;
  recover(input: SessionStart): Promise<SessionRecoveryReport>;
  branchChanged(input: BranchChange): Promise<void>;
  closeSession(cursor: RuntimeCursor): Promise<void>;
  persistBackgroundCandidate(input: {
    workspaceId: string;
    sessionId: string;
    leafId: string | null;
    lineageHash: string;
    modelKey: string;
    sourceHead: string;
    configFingerprint: string;
  }): Promise<void>;
  resolveTools(ctx?: { workspaceId?: string; sessionId?: string }): Promise<{
    cursor: RuntimeCursor;
    evidence: EvidenceService;
  }>;
}

interface WorkspaceUserTurnOwner {
  readonly dataRoot: string;
  readonly database: WorkspaceSqliteEvidenceStore;
  readonly keys: LocalWorkspaceBlobKeyProvider;
  readonly blobs: EncryptedBlobStore;
  readonly state: WorkspaceStateStore;
  readonly saga: DurableSagaJournal;
  readonly ledger: Awaited<ReturnType<typeof openWorkspaceUserTurnLedger>>;
  readonly cursorsBySession: Map<string, RuntimeCursor>;
  readonly pointersByCursor: Map<string, Array<{ ref: string; kind: string }>>;
  readonly sessions: Map<string, RuntimeSession>;
  readonly candidates: CandidateRepository;
  readonly services: Map<string, UserTurnService>;
  readonly observations: Map<string, ObservationService>;
  readonly evidences: Map<string, EvidenceService>;
  service(cursor: RuntimeCursor): UserTurnService;
  observation(cursor: RuntimeCursor): ObservationService;
  evidence(cursor: RuntimeCursor): EvidenceService;
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

function observationText(content: ToolObservation["content"]): string {
  return content
    .filter((block): block is Extract<ToolObservation["content"][number], { type: "text" }> => (
      !!block && block.type === "text" && typeof block.text === "string"
    ))
    .map((block) => block.text)
    .join("");
}

function evidenceFacts(facts: unknown, visibleText: string): EvidenceFact[] {
  if (Array.isArray(facts) && facts.length > 0) {
    return facts.map((fact) => {
      if (fact && typeof fact === "object" && "kind" in fact && typeof (fact as { kind: unknown }).kind === "string") {
        return { kind: (fact as { kind: string }).kind, value: (fact as { value?: unknown }).value };
      }
      return { kind: "note", value: fact };
    });
  }
  return [{ kind: "note", value: visibleText.length > 0 ? visibleText : "observation" }];
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
    if (derived.sessionId === "unbound" || derived.modelKey === "unbound") {
      throw new ProductionCompositionError("PCR_PI_SESSION_CONTEXT_INVALID", { field: "sessionId" });
    }
    return Object.freeze({
      workspaceId: derived.workspaceId,
      sessionId: derived.sessionId,
      leafId: derived.leafId,
      lineageHash: derived.lineageHash,
      modelKey: derived.modelKey,
    });
  };

  const ownerFor = async (cursor: RuntimeCursor, ctx: ExtensionContext): Promise<WorkspaceUserTurnOwner> => {
    const sessionDir = typeof ctx.sessionManager.getSessionDir === "function"
      ? ctx.sessionManager.getSessionDir()
      : undefined;
    const dataRoot = resolve(options.dataRoot?.(ctx)
      ?? join(typeof sessionDir === "string" && sessionDir.length > 0 ? sessionDir : ctx.cwd, ".context-runtime"));
    const existing = owners.get(cursor.workspaceId);
    if (existing) {
      const owner = await existing;
      if (owner.dataRoot !== dataRoot) {
        throw new ProductionCompositionError("PCR_PI_SESSION_SCOPE_CONFLICT", {
          expectedDataRoot: owner.dataRoot,
          actualDataRoot: dataRoot,
        });
      }
      owner.cursorsBySession.set(cursor.sessionId, cursor);
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
        const state = openWorkspaceStateStore({ database });
        const repository = openWorkspaceEvidenceRepository({ database });
        const fts = openWorkspaceEvidenceFtsIndex({ database });
        const candidates = await openWorkspaceCandidateRepository({ database });
        const services = new Map<string, UserTurnService>();
        const observations = new Map<string, ObservationService>();
        const evidences = new Map<string, EvidenceService>();
        const owner: WorkspaceUserTurnOwner = {
          dataRoot,
          database,
          keys,
          blobs,
          state,
          saga,
          ledger,
          cursorsBySession: new Map(),
          pointersByCursor: new Map(),
          sessions: new Map(),
          candidates,
          services,
          observations,
          evidences,
          evidence(candidate) {
            const key = cursorKey(candidate);
            let service = evidences.get(key);
            if (!service) {
              service = createEvidenceService({ cursor: candidate, repository, fts, blobs });
              evidences.set(key, service);
            }
            return service;
          },
          service(candidate) {
            const key = cursorKey(candidate);
            let service = services.get(key);
            if (!service) {
              const inner = createUserTurnService({ cursor: candidate, blobs, ledger });
              const resolver = createDirectiveResolver({
                cursor: candidate,
                store: {
                  put: (record) => owner.state.putDirective(record),
                  list: (scope) => owner.state.listDirectives(scope),
                },
              });
              const extractor = createDirectiveExtractor({ cursor: candidate });
              const segmenter = createClauseSegmenter({ cursor: candidate });
              service = {
                capture: async (input) => {
                  const receipt = await inner.capture(input);
                  if (input.sourceClass === "authenticated-user") {
                    const turn = {
                      userTurnId: `user_turn_${receipt.receiptId}`,
                      cursor: candidate,
                      rawTextHash: receipt.rawTextHash,
                      rawBlobId: receipt.rawBlobId,
                      utf8Bytes: receipt.utf8Bytes,
                      hostMessageId: receipt.operationId,
                      sourceClass: receipt.sourceClass,
                      capturedAt: receipt.capturedAt,
                    };
                    for (const candidateDirective of extractor.extract(turn, segmenter.segment({
                      text: input.rawText,
                      cursor: candidate,
                    }))) {
                      const stored = await resolver.apply(candidateDirective, input.signal);
                      if (stored.key) {
                        await owner.state.putClaim({
                          claimId: `cl_${stored.directiveId}`,
                          cursor: candidate,
                          key: stored.key,
                          polarity: stored.polarity,
                          status: stored.status,
                          value: stored.value,
                          authority: "inform",
                        });
                      }
                    }
                  }
                  return receipt;
                },
                abandon: (receiptId, reason) => inner.abandon(receiptId, reason),
                link: (receiptId, hostMessageId) => inner.link(receiptId, hostMessageId),
              };
              services.set(key, service);
            }
            return service;
          },
          observation(candidate) {
            const key = cursorKey(candidate);
            let service = observations.get(key);
            if (!service) {
              const inner = createObservationService({ cursor: candidate, blobs, saga });
              const reducers = createReducerRegistry({
                cursor: candidate,
                reducers: createProductionReducers(),
              });
              service = {
                async ingest(input: ToolObservation): Promise<ProjectedToolResult> {
                  const projected = await inner.ingest(input);
                  const text = observationText(input.content);
                  const reduced = await reducers.reduce({
                    observation: input,
                    text,
                    rawBlobId: projected.rawBlobId,
                    cursor: candidate,
                    ...(input.signal === undefined ? {} : { signal: input.signal }),
                  });
                  const admitted = await owner.evidence(candidate).admit({
                    cursor: candidate,
                    operationId: projected.operationId,
                    observationId: projected.observationId,
                    rawBlobId: projected.rawBlobId,
                    reducer: { id: reduced.reducer.id, revision: "1" },
                    sourceClass: input.sourceClass,
                    facts: evidenceFacts(reduced.facts, reduced.visibleText),
                    observedAt: input.capturedAt,
                    visibleText: reduced.visibleText,
                    ...(input.signal === undefined ? {} : { signal: input.signal }),
                  });
                  owner.pointersByCursor.set(key, admitted.map((record) => ({ ref: record.evidenceId, kind: record.kind })));
                  return Object.freeze({
                    ...projected,
                    evidenceIds: admitted.map((record) => record.evidenceId),
                    reducer: { id: reduced.reducer.id, revision: "1" },
                  });
                },
                acknowledge: (operationId, hostMessageId) => inner.acknowledge(operationId, hostMessageId),
              };
              observations.set(key, service);
            }
            return service;
          },
          async close() {
            services.clear();
            observations.clear();
            evidences.clear();
            try {
              await saga.close();
              await ledger.close();
              await database.close();
            } finally {
              keys!.close();
            }
          },
        };
        return owner;
      } catch (error) {
        keys?.close();
        await database.close().catch(() => undefined);
        throw error;
      }
    })();
    owners.set(cursor.workspaceId, opening);
    try {
      const owner = await opening;
      owner.cursorsBySession.set(cursor.sessionId, cursor);
      return owner;
    } catch (error) {
      if (owners.get(cursor.workspaceId) === opening) owners.delete(cursor.workspaceId);
      throw error;
    }
  };

  function quoteMessages(records: Array<{ directiveId: string; exactQuote: string }>): HostMessage[] {
    return records.map((record) => ({
      hostMessageId: record.directiveId,
      role: "user" as const,
      timestamp: 0,
      sourceClass: "authenticated-user" as const,
      content: [{ type: "text" as const, text: record.exactQuote }],
    }));
  }

  function continuityMessages(revision: { nextSafeActions: Array<{ text: string }>; revisionId: string }): HostMessage[] {
    if (revision.nextSafeActions.length === 0) return [];
    return [{
      hostMessageId: `cont_${revision.revisionId || "empty"}`,
      role: "custom" as const,
      timestamp: 0,
      sourceClass: "system" as const,
      content: [{ type: "text" as const, text: revision.nextSafeActions.map((item) => item.text).join("\n") }],
    }];
  }

  async function portsFor(owner: WorkspaceUserTurnOwner, cursor: RuntimeCursor, ctx?: ExtensionContext): Promise<RuntimeSessionPorts> {
    const userTurn = owner.service(cursor);
    const observation = owner.observation(cursor);
    const evidence = owner.evidence(cursor);
    const resolver = createDirectiveResolver({
      cursor,
      store: {
        put: (record) => owner.state.putDirective(record),
        list: (scope) => owner.state.listDirectives(scope),
      },
    });
    const model = ctx?.model;
    const contextWindow = typeof model?.contextWindow === "number" ? model.contextWindow : undefined;
    const maxOutputTokens = typeof model?.maxTokens === "number" ? model.maxTokens : undefined;
    if (contextWindow === undefined || maxOutputTokens === undefined) {
      // Route is calibrated on materialize from the request; register a fail-closed placeholder only when host limits exist.
    }
    const routeModel = cursor.modelKey;
    const routes = contextWindow !== undefined && maxOutputTokens !== undefined
      ? {
        [routeModel]: {
          modelKey: routeModel,
          contextWindow,
          maxOutputTokens,
          providerReservedTokens: 0,
        },
      }
      : {
        [routeModel]: {
          modelKey: routeModel,
          contextWindow: 1,
          maxOutputTokens: 0,
          providerReservedTokens: 0,
        },
      };
    const pricer = createTokenPricer({ cursor, routes });
    const cache = createCacheReceipt({
      cursor,
      store: {
        put: (receipt: CacheReceiptRecord) => owner.state.putCacheReceipt(receipt),
        head: async (scope) => (await owner.state.headCacheReceipt(scope)) as CacheReceiptRecord | null,
      },
    });
    const materializer = createMaterializer({
      cursor,
      pricer,
      planner: createSectionPlanner({ cursor, pricer }),
      cache,
    });
    const compaction = createCompactionService({
      cursor,
      assembler: createCompactionSnapshotAssembler({
        cursor,
        transaction: {
          async run(work) {
            return work();
          },
        },
        directives: {
          async active(scope, signal) {
            signal?.throwIfAborted();
            return resolver.active(scope, signal);
          },
        },
        continuity: {
          async current(scope) {
            return ((await owner.state.headContinuity(scope)) as ContinuityRevision | null)
              ?? emptyContinuityRevision(scope);
          },
        },
        claims: {
          async list(scope, signal) {
            signal?.throwIfAborted();
            const rows = await owner.state.listClaims(scope);
            return rows.filter((row) => row.status === "active") as CompactionClaim[];
          },
        },
        evidence: {
          async pointers(scope, signal) {
            signal?.throwIfAborted();
            const snapshot = await owner.state.readSnapshot(scope);
            return snapshot.pointers;
          },
        },
      }),
      renderer: createCheckpointRenderer({ cursor }),
      verifier: createCheckpointVerifier({
        cursor,
        pointers: createPointerCheck(owner.blobs),
      }),
    });
    const recovery = createRecoveryService({
      cursor,
      sessions: {
        async open() {
          return owner.sessions.get(cursorKey(cursor));
        },
        async close(sessionId) {
          const bound = owner.cursorsBySession.get(sessionId);
          if (!bound) return;
          owner.sessions.delete(cursorKey(bound));
        },
      },
      journal: {
        reconcile: (snapshot) => owner.saga.reconcile(snapshot),
      },
      candidates: {
        async invalidate(scope, reason, signal) {
          return owner.candidates.invalidateScope?.(scope, reason, signal) ?? 0;
        },
      },
    });
    return {
      userInput: { capture: (input) => userTurn.capture(input) },
      toolResult: { ingest: (input) => observation.ingest(input) },
      materialization: {
        async materialize(request) {
          const rows = await owner.state.readSnapshot(cursor);
          const continuity = (rows.continuity as ContinuityRevision | null) ?? emptyContinuityRevision(cursor);
          assembleRuntimeSnapshot({
            cursor,
            directives: rows.directives.filter((row) => row.status === "active"),
            claims: rows.claims.filter((row) => row.status === "active"),
            continuity,
            pointers: rows.pointers,
            sourceEntryIds: rows.sourceEntryIds,
            schemaVersion: rows.schemaVersion,
          });
          const imageBlocks = request.canonicalMessages.reduce((count, message) => (
            count + message.content.filter((block) => block.type === "image-ref").length
          ), 0);
          const reserves = reservesFromPayload({ imageBlocks });
          if (typeof request.currentContextWindow !== "number" || request.currentContextWindow <= 0) {
            throw Object.assign(new Error("PCR_BUDGET_ROUTE_UNKNOWN"), { code: "PCR_BUDGET_ROUTE_UNKNOWN" });
          }
          return materializer.materialize({
            cursor: request.cursor,
            canonicalMessages: request.canonicalMessages,
            currentContextWindow: request.currentContextWindow,
            maxOutputTokens: request.maxOutputTokens,
            reason: request.reason,
            now: request.now,
            signal: request.signal,
            ...reserves,
          }, {
            cursor,
            directives: quoteMessages(rows.directives.filter((row) => row.status === "active")),
            continuity: continuityMessages(continuity),
          });
        },
      },
      compaction: {
        prepare: (input) => compaction.prepareCompaction(input),
        async acknowledge() {},
      },
      retrieval: {
        search: (input) => evidence.search({ cursor: input.cursor, text: input.text, limit: input.limit, signal: input.signal }),
        read: (input) => evidence.read({ cursor: input.cursor, evidenceId: input.evidenceId, range: input.range, signal: input.signal }),
      },
      recovery: {
        recover: (input) => recovery.onSessionStart({
          cursor: input.cursor,
          reason: input.reason,
          hasRawBlobs: input.hasRawBlobs,
          ...(input.hostSnapshot === undefined ? {} : { hostSnapshot: input.hostSnapshot }),
          signal: input.signal,
        }),
        branchChanged: (input) => recovery.onBranchChange({
          cursor: input.cursor,
          previousCursor: input.previousCursor,
          newLeafId: input.newLeafId,
          signal: input.signal,
        }),
      },
    };
  }

  async function sessionFor(owner: WorkspaceUserTurnOwner, cursor: RuntimeCursor, ctx?: ExtensionContext): Promise<RuntimeSession> {
    const key = cursorKey(cursor);
    const existing = owner.sessions.get(key);
    if (existing) return existing;
    const session = createRuntimeSession({
      scope: {
        workspaceId: cursor.workspaceId,
        sessionId: cursor.sessionId,
        leafId: cursor.leafId,
        lineageHash: cursor.lineageHash,
      },
      ports: await portsFor(owner, cursor, ctx),
    });
    owner.sessions.set(key, session);
    owner.cursorsBySession.set(cursor.sessionId, cursor);
    return session;
  }

  async function ownerByWorkspace(workspaceId: string | undefined): Promise<WorkspaceUserTurnOwner | undefined> {
    if (workspaceId && owners.has(workspaceId)) return owners.get(workspaceId);
    if (owners.size === 1) return [...owners.values()][0];
    return undefined;
  }

  const hook = registerUserInputHook(pi, {
    cursor: cursorFromContext,
    async service(cursor, ctx) {
      const owner = await ownerFor(cursor, ctx);
      await sessionFor(owner, cursor, ctx);
      return owner.service(cursor);
    },
    clock,
    async onHardFailure(error, phase, ctx) {
      await options.onHardFailure?.(error, phase, ctx);
    },
  });
  registerToolResultHook(pi, {
    cursor: cursorFromContext,
    async service(cursor, ctx) {
      const owner = await ownerFor(cursor, ctx);
      await sessionFor(owner, cursor, ctx);
      return owner.observation(cursor);
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
  return Object.freeze({
    hook,
    close,
    lastWorkspaceId() {
      if (owners.size !== 1) return undefined;
      return [...owners.keys()][0];
    },
    lastPointers() {
      const collected: Array<{ ref: string; kind: string }> = [];
      for (const pending of owners.values()) {
        void pending;
      }
      return collected;
    },
    async ensure(ctx: ExtensionContext) {
      const cursor = cursorFromContext(ctx);
      const owner = await ownerFor(cursor, ctx);
      await sessionFor(owner, cursor, ctx);
    },
    async openSession(ctx: PiSessionContext) {
      if (ctx.sessionId === "unbound" || ctx.modelKey === "unbound") {
        throw new ProductionCompositionError("PCR_PI_SESSION_CONTEXT_INVALID", { field: "sessionId" });
      }
      const opening = await ownerByWorkspace(ctx.workspaceId);
      if (!opening) {
        throw new ProductionCompositionError("PCR_PRODUCTION_DEPENDENCY_MISSING", { dependency: "workspaceOwner" });
      }
      const cursor: RuntimeCursor = {
        workspaceId: ctx.workspaceId,
        sessionId: ctx.sessionId,
        leafId: ctx.leafId,
        lineageHash: ctx.lineageHash,
        modelKey: ctx.modelKey,
      };
      return sessionFor(opening, cursor);
    },
    async recover(input: SessionStart) {
      const opening = await ownerByWorkspace(input.cursor.workspaceId);
      if (!opening) {
        throw new ProductionCompositionError("PCR_PRODUCTION_DEPENDENCY_MISSING", { dependency: "workspaceOwner" });
      }
      await sessionFor(opening, input.cursor);
      const recovery = createRecoveryService({
        cursor: input.cursor,
        sessions: {
          async open() { return opening.sessions.get(cursorKey(input.cursor)); },
          async close(sessionId) {
            const bound = opening.cursorsBySession.get(sessionId);
            if (!bound) return;
            opening.sessions.delete(cursorKey(bound));
          },
        },
        journal: { reconcile: (snapshot) => opening.saga.reconcile(snapshot) },
        candidates: {
          async invalidate(scope, reason, signal) {
            return opening.candidates.invalidateScope?.(scope, reason, signal) ?? 0;
          },
        },
      });
      return recovery.onSessionStart(input);
    },
    async branchChanged(input: BranchChange) {
      const opening = await ownerByWorkspace(input.cursor.workspaceId);
      if (!opening) {
        throw new ProductionCompositionError("PCR_PRODUCTION_DEPENDENCY_MISSING", { dependency: "workspaceOwner" });
      }
      await sessionFor(opening, input.cursor);
      const recovery = createRecoveryService({
        cursor: input.cursor,
        sessions: {
          async open() { return opening.sessions.get(cursorKey(input.cursor)); },
          async close(sessionId) {
            const bound = opening.cursorsBySession.get(sessionId);
            if (!bound) return;
            opening.sessions.delete(cursorKey(bound));
          },
        },
        journal: { reconcile: (snapshot) => opening.saga.reconcile(snapshot) },
        candidates: {
          async invalidate(scope, reason, signal) {
            return opening.candidates.invalidateScope?.(scope, reason, signal) ?? 0;
          },
        },
      });
      await recovery.onBranchChange(input);
    },
    async closeSession(cursor: RuntimeCursor) {
      const opening = await ownerByWorkspace(cursor.workspaceId);
      if (!opening) return;
      const session = opening.sessions.get(cursorKey(cursor));
      opening.sessions.delete(cursorKey(cursor));
      await session?.close?.();
    },
    async persistBackgroundCandidate(input: {
      workspaceId: string;
      sessionId: string;
      leafId: string | null;
      lineageHash: string;
      modelKey: string;
      sourceHead: string;
      configFingerprint: string;
    }) {
      if (input.sessionId === "unbound" || input.modelKey === "unbound") return;
      const opening = owners.get(input.workspaceId) ?? (owners.size === 1 ? [...owners.values()][0] : undefined);
      if (!opening) return;
      const owner = await opening;
      await owner.candidates.prepare({
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        leafId: input.leafId,
        lineageHash: input.lineageHash,
        modelKey: input.modelKey,
        sourceHead: input.sourceHead,
        configFingerprint: input.configFingerprint,
      });
    },
    async resolveTools(ctx?: { workspaceId?: string; sessionId?: string }) {
      if (!ctx?.sessionId) {
        throw new ProductionCompositionError("PCR_PI_SESSION_CONTEXT_INVALID", { field: "sessionId" });
      }
      const opening = await ownerByWorkspace(ctx.workspaceId);
      if (!opening) {
        throw new ProductionCompositionError("PCR_PRODUCTION_DEPENDENCY_MISSING", {
          dependency: "workspaceOwner",
        });
      }
      const cursor = opening.cursorsBySession.get(ctx.sessionId);
      if (!cursor) {
        throw new ProductionCompositionError("PCR_PI_SESSION_CONTEXT_INVALID", { field: "sessionId" });
      }
      if (ctx.workspaceId && ctx.workspaceId !== cursor.workspaceId) {
        throw new ProductionCompositionError("PCR_PI_SESSION_SCOPE_CONFLICT", {
          expectedWorkspaceId: cursor.workspaceId,
          actualWorkspaceId: ctx.workspaceId,
        });
      }
      return { cursor, evidence: opening.evidence(cursor) };
    },
  });
}
