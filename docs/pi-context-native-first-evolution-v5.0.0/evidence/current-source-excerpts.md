# 当前源码证据摘录

这些为用户提供的源码片段；完整文件仍以固定commit及附件为准。原模块探针脚本没有修复或改写被测逻辑。

## `packages/pi-adapter/src/user-input-hook.ts` · L1–L28

[固定源码](https://github.com/lkyprogramer/pi-context/blob/e14804daf9aa31b342ddca718d789fa6860c2244/packages/pi-adapter/src/user-input-hook.ts#L1-L28)

```text
1: import * as PiHost from "@earendil-works/pi-coding-agent";
2: import type {
3:   AgentSettledEvent,
4:   ExtensionAPI,
5:   ExtensionContext,
6:   InputEvent,
7:   InputEventResult,
8:   MessageStartEvent,
9:   SessionStartEvent,
10:   SessionTreeEvent,
11: } from "@earendil-works/pi-coding-agent";
12: import { domainHash, type RuntimeCursor } from "@pcr/contracts";
13: import type { UserInputEvent, UserInputReceipt, UserTurnService } from "@pcr/runtime";
14: 
15: /*
16:  * This runtime import is intentional: Pi's extension loader aliases the package
17:  * to the active host, so an unpatched stock 0.84.4 host fails during extension
18:  * loading instead of accepting and then swallowing user input.
19:  */
20: if (PiHost.PCR_INGRESS_METADATA_CONTRACT !== "pcr-ingress-metadata-v1") {
21:   throw new TypeError("PCR_PI_INGRESS_METADATA_CONTRACT_MISSING");
22: }
23: 
24: const METADATA_NAMESPACE = "pcr.user-input-receipt.v1";
25: const INPUT_ID_PATTERN = /^pi_input_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
26: 
27: export interface RuntimeSessionUserIngress {
28:   ingestUserInput(input: UserInputEvent): Promise<UserInputReceipt>;
```

## `packages/pi-adapter/src/user-input-hook.ts` · L215–L240

[固定源码](https://github.com/lkyprogramer/pi-context/blob/e14804daf9aa31b342ddca718d789fa6860c2244/packages/pi-adapter/src/user-input-hook.ts#L215-L240)

```text
215:         return;
216:       }
217:     }
218:   };
219: 
220:   pi.on("input", async (event: InputEvent, ctx: ExtensionContext): Promise<InputEventResult> => {
221:     if (event.images && event.images.length > 0) {
222:       const error = new TypeError("PCR_PI_INPUT_IMAGES_UNSUPPORTED");
223:       await fail(error, "unsupported-images", ctx);
224:       return { action: "reject", error };
225:     }
226:     try {
227:       if (!INPUT_ID_PATTERN.test(event.inputId)) throw new TypeError("PCR_PI_INPUT_ID_INVALID");
228:       const cursor = snapshotCursor(dependencies.cursor(ctx));
229:       const capturedAt = dependencies.clock.now();
230:       if (!Number.isSafeInteger(capturedAt) || capturedAt < 0) throw new TypeError("PCR_PI_INPUT_CLOCK_INVALID");
231:       const operationId = `input_${domainHash("pi-input-operation", {
232:         cursor,
233:         inputId: event.inputId,
234:         source: event.source,
235:         streamingBehavior: event.streamingBehavior ?? null,
236:       })}`;
237:       const service = await dependencies.service(cursor, ctx);
238:       const payload: UserInputEvent = {
239:         operationId,
240:         cursor,
```

## `packages/runtime/src/observation-envelope.ts` · L63–L83

[固定源码](https://github.com/lkyprogramer/pi-context/blob/e14804daf9aa31b342ddca718d789fa6860c2244/packages/runtime/src/observation-envelope.ts#L63-L83)

```text
63: function isBinary(value: unknown): value is Uint8Array {
64:   return value instanceof Uint8Array;
65: }
66: 
67: function sanitize(value: unknown, seen: WeakSet<object>): unknown {
68:   if (value === undefined || typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
69:     failCanonical("non-canonical");
70:   }
71:   if (typeof value === "number" && !Number.isFinite(value)) failCanonical("non-canonical-number");
72:   if (value === null || typeof value !== "object") return value;
73:   if (isBinary(value)) {
74:     return { type: "binary", encoding: "base64", data: Buffer.from(value).toString("base64") };
75:   }
76:   if (seen.has(value)) failCanonical("cyclic");
77:   seen.add(value);
78:   if (Array.isArray(value)) return value.map((item) => sanitize(item, seen));
79:   const record: Record<string, unknown> = {};
80:   for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
81:     record[key] = sanitize(item, seen);
82:   }
83:   return record;
```

## `packages/runtime/src/observation-envelope.ts` · L200–L234

[固定源码](https://github.com/lkyprogramer/pi-context/blob/e14804daf9aa31b342ddca718d789fa6860c2244/packages/runtime/src/observation-envelope.ts#L200-L234)

```text
200: export function renderObservationView(input: {
201:   original: ObservationEnvelope;
202:   reducedText: string;
203:   evidenceId: string;
204:   budgetTokens: number;
205:   estimate: (text: string) => number;
206: }): ObservationView {
207:   if (!input || typeof input !== "object") fail("input");
208:   assertEnvelope(input.original);
209:   if (typeof input.reducedText !== "string") fail("reducedText");
210:   if (typeof input.evidenceId !== "string") fail("evidenceId");
211:   if (!Number.isFinite(input.budgetTokens) || input.budgetTokens < 0) fail("budgetTokens");
212:   if (typeof input.estimate !== "function") fail("estimate");
213:   const original = input.original;
214:   if (original.content.some(isUnknownBlock)) {
215:     return { content: original.content, mode: "bypass" };
216:   }
217:   const serialized = canonicalJson(original.content);
218:   const imageCount = original.content.filter((block) => (
219:     !!block && typeof block === "object" && (block as { type?: unknown }).type === "image"
220:   )).length;
221:   const verbatimCost = input.estimate(serialized) + imageCount * IMAGE_RESERVE_TOKENS;
222:   const footer = input.evidenceId.length > 0 ? `[pcr-evidence ${input.evidenceId}]` : "";
223:   const footerCost = footer.length > 0 ? input.estimate(footer) : 0;
224:   if (verbatimCost + footerCost <= input.budgetTokens) {
225:     return { content: original.content, mode: "verbatim" };
226:   }
227:   const reducedBody = input.reducedText.length > 0 ? input.reducedText : observationTextFromContent(original.content);
228:   const content: unknown[] = [{ type: "text", text: reducedBody }];
229:   if (footer.length > 0) content.push({ type: "text", text: footer });
230:   return { content, mode: "reduced" };
231: }
232: 
233: export function presentExactObservationPage(input: {
234:   bytes: Uint8Array;
```

## `packages/core/src/reducers/read.ts` · L12–L29

[固定源码](https://github.com/lkyprogramer/pi-context/blob/e14804daf9aa31b342ddca718d789fa6860c2244/packages/core/src/reducers/read.ts#L12-L29)

```text
12: export function reduceReadResult(
13:   text: string,
14:   input: { path: string; start?: number; end?: number; truncated?: boolean; rawBlobId?: string },
15: ): ReducerOutput {
16:   const path = normalizeWorkspacePath(input.path);
17:   const start = input.start ?? 1;
18:   const end = input.end ?? start + text.split("\n").length - 1;
19:   const pointer = input.truncated
20:     ? `[truncated raw:${rawPointer(input.rawBlobId)}]`
21:     : `[raw:${rawPointer(input.rawBlobId)}]`;
22:   return {
23:     visibleText: [`[read ${path} ${start}-${end}]`, text.slice(0, 4000), pointer].join("\n"),
24:     facts: [{ kind: "read-range", value: { path, start, end, truncated: input.truncated === true }, authority: "inform" }],
25:   };
26: }
27: 
28: export const readReducer: Reducer = {
29:   id: "read",
```

## `packages/core/src/reducers/production.ts` · L9–L20

[固定源码](https://github.com/lkyprogramer/pi-context/blob/e14804daf9aa31b342ddca718d789fa6860c2244/packages/core/src/reducers/production.ts#L9-L21)

```text
9: 
10: export function createProductionReducers(): Reducer[] {
11:   return [
12:     bashReducer,
13:     testLogReducer,
14:     buildLogReducer,
15:     readReducer,
16:     searchReducer,
17:     fileMutationReducer,
18:     pointerReducer,
19:   ];
20: }
```

## `apps/pi-context-runtime/src/composition-root.ts` · L856–L923

[固定源码](https://github.com/lkyprogramer/pi-context/blob/e14804daf9aa31b342ddca718d789fa6860c2244/apps/pi-context-runtime/src/composition-root.ts#L856-L923)

```text
856:             const key = sessionIdentityKey(candidate);
857:             let service = observations.get(key);
858:             if (!service) {
859:               const inner = createObservationService({ cursor: candidate, blobs, saga });
860:               service = {
861:                 async ingest(input: ToolObservation): Promise<ProjectedToolResult> {
862:                   const projected = await inner.ingest(input);
863:                   const text = observationText(input.content);
864:                   let reducedText = text;
865:                   let reducerId = projected.reducer.id;
866:                   let facts: unknown = [{ kind: "note", value: text.length > 0 ? text : "observation" }];
867:                   try {
868:                     const reducers = createReducerRegistry({
869:                       cursor: input.cursor,
870:                       reducers: createProductionReducers(),
871:                     });
872:                     const reduced = await reducers.reduce({
873:                       observation: input,
874:                       text,
875:                       rawBlobId: projected.rawBlobId,
876:                       cursor: input.cursor,
877:                       ...(input.signal === undefined ? {} : { signal: input.signal }),
878:                     });
879:                     reducedText = reduced.visibleText;
880:                     reducerId = reduced.reducer.id;
881:                     facts = reduced.facts;
882:                   } catch {
883:                     reducedText = text;
884:                   }
885:                   const admitted = await owner.evidence(input.cursor).admit({
886:                     cursor: input.cursor,
887:                     operationId: projected.operationId,
888:                     observationId: projected.observationId,
889:                     rawBlobId: projected.rawBlobId,
890:                     reducer: { id: reducerId, revision: "1" },
891:                     sourceClass: input.sourceClass,
892:                     facts: evidenceFacts(facts, text),
893:                     observedAt: input.capturedAt,
894:                     visibleText: text,
895:                     toolCallId: input.toolCallId,
896:                     ...(input.signal === undefined ? {} : { signal: input.signal }),
897:                   });
898:                   owner.pointersByCursor.set(sessionIdentityKey(input.cursor), admitted.map((record) => ({ ref: record.evidenceId, kind: record.kind })));
899:                   const view = renderObservationView({
900:                     original: {
901:                       format: "pcr-observation-v1",
902:                       toolCallId: input.toolCallId,
903:                       toolName: input.toolName,
904:                       content: input.content,
905:                       details: input.details ?? null,
906:                       isError: input.isError === true,
907:                     },
908:                     reducedText,
909:                     evidenceId: admitted[0]?.evidenceId ?? "",
910:                     budgetTokens: DEFAULT_OBSERVATION_VIEW_BUDGET_TOKENS,
911:                     estimate: estimateTextTokens,
912:                   });
913:                   return Object.freeze({
914:                     ...projected,
915:                     evidenceIds: admitted.map((record) => record.evidenceId),
916:                     visibleContent: toHostVisibleContent(view.content),
917:                     isError: input.isError === true,
918:                     reducer: { id: reducerId, revision: "1" },
919:                   });
920:                 },
921:                 acknowledge: (operationId, hostMessageId) => inner.acknowledge(operationId, hostMessageId),
922:               };
923:               observations.set(key, service);
```

## `pnpm-workspace.yaml` · L1–L6

[固定源码](https://github.com/lkyprogramer/pi-context/blob/e14804daf9aa31b342ddca718d789fa6860c2244/pnpm-workspace.yaml#L1-L12)

```text
1: packages:
2:   - apps/*
3:   - packages/*
4: 
5: patchedDependencies:
6:   '@earendil-works/pi-coding-agent@0.84.4': patches/@earendil-works__pi-coding-agent@0.84.4.patch
```
