# 当前源码热点摘录

固定HEAD bb7aea1b88f6645fb8e4f0b930a4087630e7a679。摘录只作证据，不是补丁。数字为源文件行号。

## apps/pi-context-runtime/src/composition-root.ts:179-212

SHA256: `4f3784fcd97982a5c9bfbe8c2b354aeabfde6221b8d241669af77236d2f91b03`

```text
179: export function derivePiSessionContext(
180:   ctx: PiRuntimeContext,
181:   identity: ProductionSessionIdentityFactory,
182: ): PiSessionContext {
183:   if (!ctx || typeof ctx !== "object") {
184:     throw new ProductionCompositionError("PCR_PI_SESSION_CONTEXT_INVALID", { field: "context" });
185:   }
186:   requireNonEmpty(ctx.cwd, "cwd");
187:   const sessionId = ctx.sessionManager?.getSessionId();
188:   requireNonEmpty(sessionId, "sessionManager.sessionId");
189:   const leafId = ctx.sessionManager.getLeafId();
190:   if (leafId !== null) requireNonEmpty(leafId, "sessionManager.leafId");
191:   const branchIds = ctx.sessionManager.getBranch().map((entry) => entry.id);
192:   const headerId = ctx.sessionManager.getHeader()?.id;
193:   // Pi has no branch entries at session_start; its persisted session header is the real root anchor.
194:   const lineageEntryIds = branchIds.length > 0 ? branchIds : headerId ? [headerId] : [];
195:   if (lineageEntryIds.length === 0) {
196:     throw new ProductionCompositionError("PCR_PI_SESSION_CONTEXT_INVALID", {
197:       field: "sessionManager.lineage",
198:     });
199:   }
200:   if (!identity || typeof identity.create !== "function") {
201:     throw new ProductionCompositionError("PCR_PRODUCTION_DEPENDENCY_MISSING", {
202:       dependency: "identity.create",
203:     });
204:   }
205:   const identityInput = {
206:     workspacePath: ctx.cwd,
207:     sessionId,
208:     leafId,
209:     lineageEntryIds,
210:     modelKey: modelKey(ctx),
211:   };
212:   const cursor = identity.create(identityInput);
```

## apps/pi-context-runtime/src/composition-root.ts:647-685

SHA256: `4f3784fcd97982a5c9bfbe8c2b354aeabfde6221b8d241669af77236d2f91b03`

```text
647:             const key = cursorKey(candidate);
648:             let service = observations.get(key);
649:             if (!service) {
650:               const inner = createObservationService({ cursor: candidate, blobs, saga });
651:               const reducers = createReducerRegistry({
652:                 cursor: candidate,
653:                 reducers: createProductionReducers(),
654:               });
655:               service = {
656:                 async ingest(input: ToolObservation): Promise<ProjectedToolResult> {
657:                   const projected = await inner.ingest(input);
658:                   const text = observationText(input.content);
659:                   const reduced = await reducers.reduce({
660:                     observation: input,
661:                     text,
662:                     rawBlobId: projected.rawBlobId,
663:                     cursor: candidate,
664:                     ...(input.signal === undefined ? {} : { signal: input.signal }),
665:                   });
666:                   const admitted = await owner.evidence(candidate).admit({
667:                     cursor: candidate,
668:                     operationId: projected.operationId,
669:                     observationId: projected.observationId,
670:                     rawBlobId: projected.rawBlobId,
671:                     reducer: { id: reduced.reducer.id, revision: "1" },
672:                     sourceClass: input.sourceClass,
673:                     facts: evidenceFacts(reduced.facts, reduced.visibleText),
674:                     observedAt: input.capturedAt,
675:                     visibleText: reduced.visibleText,
676:                     ...(input.signal === undefined ? {} : { signal: input.signal }),
677:                   });
678:                   owner.pointersByCursor.set(key, admitted.map((record) => ({ ref: record.evidenceId, kind: record.kind })));
679:                   return Object.freeze({
680:                     ...projected,
681:                     evidenceIds: admitted.map((record) => record.evidenceId),
682:                     reducer: { id: reduced.reducer.id, revision: "1" },
683:                   });
684:                 },
685:                 acknowledge: (operationId, hostMessageId) => inner.acknowledge(operationId, hostMessageId),
```

## apps/pi-context-runtime/src/composition-root.ts:1190-1260

SHA256: `4f3784fcd97982a5c9bfbe8c2b354aeabfde6221b8d241669af77236d2f91b03`

```text
1190:       },
1191:       compaction: {
1192:         prepare: async (input) => {
1193:           // Projection completeness is independent of whether this leaf already has
1194:           // a directive. Verify the complete branch first, then atomically publish it.
1195:           if (ctx) {
1196:             const projected = new Map<string, StoredDirectiveRecord>();
1197:             const restoredTurns = new Set<string>();
1198:             const branchResolver = createDirectiveResolver({
1199:               cursor,
1200:               store: {
1201:                 async list() { return [...projected.values()]; },
1202:                 async put(record) { projected.set(record.directiveId, record); },
1203:               },
1204:             });
1205:             const extractor = createDirectiveExtractor({ cursor });
1206:             const segmenter = createClauseSegmenter({ cursor });
1207:             for (const entry of ctx.sessionManager.getBranch()) {
1208:               input.signal?.throwIfAborted();
1209:               const source = persistedUserInputReceipt(entry);
1210:               if (!source) continue;
1211:               if (source.metadata.cursor.workspaceId !== cursor.workspaceId) {
1212:                 throw new TypeError("PCR_PI_INPUT_SESSION_MISMATCH");
1213:               }
1214:               const receipt = await owner.ledger.get(source.metadata.cursor, source.metadata.receiptId);
1215:               if (!receipt || !("hostMessageId" in receipt) || receipt.hostMessageId !== source.entryId
1216:                 || receipt.rawTextHash !== source.metadata.rawTextHash) {
1217:                 throw new TypeError("PCR_PI_INPUT_METADATA_INVALID");
1218:               }
1219:               if (receipt.sourceClass !== "authenticated-user") continue;
1220:               const userTurnId = cursorKey(receipt.cursor) === cursorKey(cursor)
1221:                 ? `user_turn_${source.metadata.receiptId}`
1222:                 : `user_turn_projection_${domainHash("branch-user-turn", { receiptId: source.metadata.receiptId, cursor })}`;
1223:               if (restoredTurns.has(userTurnId)) continue;
1224:               restoredTurns.add(userTurnId);
1225:               const raw = await owner.blobs.read(receipt.cursor, receipt.rawBlobId);
1226:               const rawText = new TextDecoder("utf-8", { fatal: true }).decode(raw);
1227:               const turn = { ...receipt, cursor, userTurnId };
1228:               for (const directive of extractor.extract(turn, segmenter.segment({ text: rawText, cursor }), input.signal)) {
1229:                 await branchResolver.apply(directive, input.signal);
1230:               }
1231:             }
1232:             if (restoredTurns.size > 0) {
1233:               // Inputs captured on this leaf but not appended by Pi yet remain newer
1234:               // than the restored branch. Keep their existing polarity/status.
1235:               for (const record of await owner.state.listDirectives(cursor)) {
1236:                 if (restoredTurns.has(record.userTurnId)) continue;
1237:                 if (record.key && record.status === "active") {
1238:                   for (const [id, prior] of projected) {
1239:                     if (prior.key === record.key && prior.status === "active") {
1240:                       projected.set(id, { ...prior, status: "superseded", supersededBy: record.directiveId });
1241:                     }
1242:                   }
1243:                 }
1244:                 projected.set(record.directiveId, record);
1245:               }
1246:               input.signal?.throwIfAborted();
1247:               if (cursorKey(cursorFromContext(ctx)) !== cursorKey(cursor)) {
1248:                 throw new ProductionCompositionError("PCR_PI_SESSION_SCOPE_CONFLICT");
1249:               }
1250:               const directives = [...projected.values()];
1251:               await owner.state.putDirectiveProjection(cursor, directives, directives.flatMap((record) => record.key ? [{
1252:                 claimId: `cl_${record.directiveId}`, cursor, key: record.key,
1253:                 polarity: record.polarity, status: record.status, value: record.value, authority: "inform" as const,
1254:               }] : []));
1255:             }
1256:           }
1257:           const decision = await compaction.prepareCompaction(input);
1258:           if (decision.kind === "pcr") {
1259:             await owner.compactionJournal.stage({
1260:               cursor,
```

## apps/pi-context-runtime/src/composition-root.ts:1303-1356

SHA256: `4f3784fcd97982a5c9bfbe8c2b354aeabfde6221b8d241669af77236d2f91b03`

```text
1303:   async function sessionFor(owner: WorkspaceUserTurnOwner, cursor: RuntimeCursor, ctx?: ExtensionContext): Promise<RuntimeSession> {
1304:     const key = cursorKey(cursor);
1305:     const existing = owner.sessions.get(key);
1306:     if (existing) return existing;
1307:     const session = createRuntimeSession({
1308:       scope: {
1309:         workspaceId: cursor.workspaceId,
1310:         sessionId: cursor.sessionId,
1311:         leafId: cursor.leafId,
1312:         lineageHash: cursor.lineageHash,
1313:       },
1314:       ports: await portsFor(owner, cursor, ctx),
1315:     });
1316:     owner.sessions.set(key, session);
1317:     owner.cursorsBySession.set(cursor.sessionId, cursor);
1318:     return session;
1319:   }
1320: 
1321:   async function ownerByWorkspace(workspaceId: string | undefined): Promise<WorkspaceUserTurnOwner | undefined> {
1322:     if (!workspaceId) return undefined;
1323:     return owners.get(workspaceId);
1324:   }
1325: 
1326:   const hook = registerUserInputHook(pi, {
1327:     cursor: cursorFromContext,
1328:     async service(cursor, ctx) {
1329:       const owner = await ownerFor(cursor, ctx);
1330:       const session = await sessionFor(owner, cursor, ctx);
1331:       const turns = owner.service(cursor);
1332:       return {
1333:         ingestUserInput: (input) => session.ingestUserInput(input),
1334:         link: (receiptId, hostMessageId) => turns.link(receiptId, hostMessageId),
1335:         abandon: (receiptId, reason) => turns.abandon(receiptId, reason),
1336:       };
1337:     },
1338:     clock,
1339:     async onHardFailure(error, phase, ctx) {
1340:       await options.onHardFailure?.(error, phase, ctx);
1341:     },
1342:   });
1343:   registerToolResultHook(pi, {
1344:     cursor: cursorFromContext,
1345:     async service(cursor, ctx) {
1346:       const owner = await ownerFor(cursor, ctx);
1347:       const session = await sessionFor(owner, cursor, ctx);
1348:       return {
1349:         ingestToolResult: (input) => session.ingestToolResult(input),
1350:       };
1351:     },
1352:     clock,
1353:     async onHardFailure(error, phase, ctx) {
1354:       await options.onHardFailure?.(error, phase, ctx);
1355:     },
1356:   });
```

## packages/runtime/src/observation-service.ts:73-103

SHA256: `825df0fa44fcf772db86ae42add45f370faf11becfc7946f2916e0fac1f8e994`

```text
73: function sameCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
74:   return left.workspaceId === right.workspaceId
75:     && left.sessionId === right.sessionId
76:     && left.leafId === right.leafId
77:     && left.lineageHash === right.lineageHash
78:     && left.modelKey === right.modelKey;
79: }
80: 
81: function rawToolBytes(content: ToolObservation["content"]): Buffer {
82:   if (!Array.isArray(content)) failInput("input.content");
83:   const text = content
84:     .filter((block): block is Extract<HostContentBlock, { type: "text" }> => (
85:       !!block && block.type === "text" && typeof block.text === "string"
86:     ))
87:     .map((block) => block.text)
88:     .join("");
89:   return Buffer.from(text, "utf8");
90: }
91: 
92: function projectVisible(rawBlobId: string, operationId: string, observationId: string, isError: boolean): ProjectedToolResult {
93:   return {
94:     operationId,
95:     observationId,
96:     rawBlobId: rawBlobId as ProjectedToolResult["rawBlobId"],
97:     evidenceIds: [],
98:     visibleContent: [{ type: "text", text: `[pcr observation pointer] ctx://observation/${rawBlobId}` }],
99:     isError,
100:     reducer: { id: REDUCER.id, revision: REDUCER.revision },
101:   };
102: }
103: 
```

## packages/pi-adapter/src/tool-result-hook.ts:73-97

SHA256: `bdcab1feed48a4d31661371b489db36121b7fe9a0c681256a2afa262c7c238b3`

```text
73: 
74: function asContent(event: ToolResultEvent): ToolObservation["content"] {
75:   return Array.isArray(event.content)
76:     ? event.content.map((block) => {
77:       if (block && block.type === "text" && typeof block.text === "string") {
78:         return { type: "text" as const, text: block.text };
79:       }
80:       return { type: "text" as const, text: "" };
81:     })
82:     : [];
83: }
84: 
85: function validateDependencies(input: ToolResultHookDependencies): void {
86:   if (!input || typeof input !== "object") throw new TypeError("PCR_PI_TOOL_RESULT_DEPENDENCY_MISSING:input");
87:   if (typeof input.cursor !== "function") throw new TypeError("PCR_PI_TOOL_RESULT_DEPENDENCY_MISSING:cursor");
88:   if (typeof input.service !== "function") throw new TypeError("PCR_PI_TOOL_RESULT_DEPENDENCY_MISSING:service");
89:   if (!input.clock || typeof input.clock.now !== "function") throw new TypeError("PCR_PI_TOOL_RESULT_DEPENDENCY_MISSING:clock");
90:   if (typeof input.onHardFailure !== "function") throw new TypeError("PCR_PI_TOOL_RESULT_DEPENDENCY_MISSING:onHardFailure");
91: }
92: 
93: function toHostResult(projected: ProjectedToolResult, event: ToolResultEvent): ToolResultEventResult {
94:   return {
95:     content: projected.visibleContent as ToolResultEventResult["content"],
96:     details: event.details,
97:     isError: event.isError,
```

## packages/core/src/materialization/dedup.ts:1-68

SHA256: `e6ac1d14aa62da4fc0411b889842b62bfb7c45308271ba4d4478ccbb1403c3f3`

```text
1: import { canonicalJson, domainHash, type HostMessage } from "@pcr/contracts";
2: 
3: function contentHash(message: HostMessage): string {
4:   return domainHash("materialization-content", {
5:     role: message.role,
6:     content: canonicalJson(message.content),
7:   });
8: }
9: 
10: function takeUnique(
11:   messages: readonly HostMessage[],
12:   seenIds: Set<string>,
13:   seenContent: Set<string>,
14: ): HostMessage[] {
15:   const out: HostMessage[] = [];
16:   for (const message of messages) {
17:     const id = message.hostMessageId;
18:     const hash = contentHash(message);
19:     if (seenIds.has(id) || seenContent.has(hash)) continue;
20:     seenIds.add(id);
21:     seenContent.add(hash);
22:     out.push(message);
23:   }
24:   return out;
25: }
26: 
27: function pairId(message: HostMessage): string | undefined {
28:   if (typeof message.toolCallId === "string" && message.toolCallId.length > 0) return message.toolCallId;
29:   return undefined;
30: }
31: 
32: function restoreToolPairs(kept: HostMessage[], original: readonly HostMessage[]): HostMessage[] {
33:   const keptIds = new Set(kept.map((item) => item.hostMessageId));
34:   const presentCalls = new Set(
35:     kept.filter((item) => item.role === "assistant" && pairId(item)).map((item) => pairId(item)!),
36:   );
37:   const extras: HostMessage[] = [];
38:   for (const message of kept) {
39:     if (message.role !== "tool-result") continue;
40:     const id = pairId(message);
41:     if (!id || presentCalls.has(id)) continue;
42:     const call = original.find((item) => item.role === "assistant" && pairId(item) === id);
43:     if (call && !keptIds.has(call.hostMessageId)) {
44:       extras.push(call);
45:       keptIds.add(call.hostMessageId);
46:       presentCalls.add(id);
47:     }
48:   }
49:   return extras.length === 0 ? kept : [...extras, ...kept];
50: }
51: 
52: export function dedupMaterializationMessages(
53:   directives: readonly HostMessage[],
54:   history: readonly HostMessage[],
55:   active: readonly HostMessage[],
56: ): { directives: HostMessage[]; history: HostMessage[]; active: HostMessage[] } {
57:   const seenIds = new Set<string>();
58:   const seenContent = new Set<string>();
59:   const activeOut = takeUnique(active, seenIds, seenContent);
60:   const historyOut = takeUnique(history, seenIds, seenContent);
61:   const directiveOut = takeUnique(directives, seenIds, seenContent);
62:   const original = [...directives, ...history, ...active];
63:   return {
64:     directives: directiveOut,
65:     history: restoreToolPairs(historyOut, original),
66:     active: restoreToolPairs(activeOut, original),
67:   };
68: }
```

## packages/pi-adapter/src/message-codec.ts:121-145

SHA256: `126935a5bc8a6ac8f2888117c51c538ca61d2c7a4b5737247031d7e2d101e296`

```text
121: function splitContent(content: unknown): { blocks: HostContentBlock[]; opaque: unknown[] } {
122:   if (typeof content === "string") {
123:     return { blocks: [{ type: "text", text: content }], opaque: [] };
124:   }
125:   if (!Array.isArray(content)) {
126:     if (content === undefined) return { blocks: [], opaque: [] };
127:     return { blocks: [], opaque: [content] };
128:   }
129:   const blocks: HostContentBlock[] = [];
130:   const opaque: unknown[] = [];
131:   for (const item of content) {
132:     if (isHostBlock(item)) blocks.push(item);
133:     else opaque.push(item);
134:   }
135:   return { blocks, opaque };
136: }
137: 
138: export function createMessageCodec(input: CreateMessageCodecInput): MessageCodec {
139:   if (!input || typeof input !== "object") failMissing("input");
140:   if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
141:   const bound = snapshotCursor(input.cursor, "input.cursor");
142: 
143:   return {
144:     wrap(event: WrapMessageInput): PiMessageEnvelope {
145:       if (!event || typeof event !== "object") failInput("event");
```

## packages/runtime/src/evidence-service.ts:310-342

SHA256: `18649593e8a6f854ad92022b9a8b63ed19c22c3f7a586e32bb64be4c3a17077d`

```text
310:     }
311:     requireNonEmpty(query.text, "query.text");
312:     if (query.signal !== undefined && !(query.signal instanceof AbortSignal)) failInput("query.signal");
313:     query.signal?.throwIfAborted();
314:     return this.#fts.search(query);
315:   }
316: 
317:   async read(req: EvidenceRead): Promise<ExactPage> {
318:     if (!req || typeof req !== "object") failInput("req");
319:     const cursor = snapshotCursor(req.cursor, "req.cursor");
320:     if (!sameCursor(cursor, this.#cursor)) {
321:       throw new EvidenceServiceError("PCR_EVIDENCE_SCOPE_MISMATCH");
322:     }
323:     requireNonEmpty(req.evidenceId, "req.evidenceId");
324:     if (req.signal !== undefined && !(req.signal instanceof AbortSignal)) failInput("req.signal");
325:     req.signal?.throwIfAborted();
326:     const record = await this.#repository.get(cursor, req.evidenceId);
327:     if (!record) throw new EvidenceServiceError("PCR_EVIDENCE_NOT_FOUND", { evidenceId: req.evidenceId });
328:     if (!sameCursor(record.cursor, cursor)) {
329:       throw new EvidenceServiceError("PCR_EVIDENCE_SCOPE_MISMATCH");
330:     }
331:     if (domainHash("evidence-payload", record.value) !== record.contentHash) {
332:       throw new EvidenceServiceError("PCR_EVIDENCE_INTEGRITY", { field: "contentHash" });
333:     }
334:     req.signal?.throwIfAborted();
335:     const full = await this.#blobs.read(cursor, record.rawBlobId);
336:     const byteLength = full.byteLength;
337:     const digest = createHash("sha256").update(full).digest("hex");
338:     const range = normalizeRange(req.range, byteLength);
339:     return {
340:       evidenceId: record.evidenceId,
341:       rawBlobId: record.rawBlobId,
342:       bytes: Uint8Array.from(full.subarray(range.start, range.endExclusive)),
```

## packages/storage-node/src/fts-index.ts:157-209

SHA256: `9808ad51eccb802d074cc8ee6207d930a2b8a214348d40f3a0d7e3c3708f645c`

```text
157:   async search(query: EvidenceQuery): Promise<SearchHit[]> {
158:     this.#assertOpen();
159:     if (!query || typeof query !== "object") failInput("query");
160:     const cursor = snapshotCursor(query.cursor, "query.cursor");
161:     if (cursor.workspaceId !== this.#database.workspaceId) {
162:       throw new EvidenceFtsError("PCR_FTS_SCOPE_MISMATCH");
163:     }
164:     requireNonEmpty(query.text, "query.text");
165:     const match = compileSafeFtsQuery(query.text);
166:     if (match.length === 0) failInput("query.text");
167:     const limit = query.limit === undefined ? DEFAULT_LIMIT : query.limit;
168:     if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) failInput("query.limit");
169:     query.signal?.throwIfAborted();
170:     try {
171:       const version = this.#database.read("check-evidence-fts-version", (db) => {
172:         const dataVersion = db.prepare("PRAGMA data_version").get() as { data_version: number };
173:         const totalChanges = db.prepare("SELECT total_changes() AS total_changes").get() as {
174:           total_changes: number;
175:         };
176:         return { dataVersion: dataVersion.data_version, totalChanges: totalChanges.total_changes };
177:       });
178:       const key = searchCacheKey(cursor, query.text, limit, version);
179:       if (this.#latestSearch?.key === key) return copySearchHits(this.#latestSearch.hits);
180:       const hits = this.#database.read("search-evidence-fts", (db) => {
181:         const rows = db.prepare(`
182:           SELECT
183:             evidence_fts.evidence_id AS evidence_id,
184:             evidence.kind AS kind,
185:             bm25(evidence_fts) AS rank,
186:             snippet(evidence_fts, 1, '', '', '…', 12) AS snippet
187:           FROM evidence_fts
188:           JOIN evidence ON evidence.evidence_id = evidence_fts.evidence_id
189:           WHERE evidence_fts MATCH ?
190:             AND evidence.workspace_id = ?
191:             AND evidence.session_id = ?
192:             AND evidence.leaf_id IS ?
193:             AND evidence.lineage_hash = ?
194:             AND evidence.model_key = ?
195:           ORDER BY rank ASC, evidence.evidence_id ASC
196:           LIMIT ?
197:         `).all(
198:           match,
199:           cursor.workspaceId,
200:           cursor.sessionId,
201:           cursor.leafId,
202:           cursor.lineageHash,
203:           cursor.modelKey,
204:           limit,
205:         ) as Array<{ evidence_id: string; kind: string; rank: number; snippet: string }>;
206:         return rows.map((row, index) => ({
207:           evidenceId: row.evidence_id,
208:           kind: row.kind,
209:           rank: typeof row.rank === "number" && Number.isFinite(row.rank) ? row.rank : index,
```

## packages/benchmark/src/scoring/probe.ts:40-70

SHA256: `39fd231a7267b2ba5447e10448c03500cf62430ce360142cd0c725d5d856d2df`

```text
40:   bucket: ProbeParseBucket;
41: }
42: 
43: const SUMMARY_MARKERS = [/checkpoint v2/i, /compaction summary/i, /^summary:/i];
44: const TOOL_CALL_MARKERS = [
45:   /<tool_call\b/i,
46:   /<\/tool_call>/i,
47:   /<function\s*=/i,
48:   /\btoolCall\b/i,
49:   /\btool_call\b/i,
50:   /"type"\s*:\s*"tool_call"/i,
51:   /<read_file\b/i,
52:   /<\/read_file>/i,
53:   /<bash\b/i,
54:   /<\/bash>/i,
55: ];
56: const NON_ANSWER_MARKERS = [
57:   /^(i don'?t know|unknown|n\/a|none|idk)\b/i,
58:   /cannot (?:answer|tell|determine)/i,
59:   /as an ai\b/i,
60:   /no (?:idea|information)\b/i,
61: ];
62: const ACTION_REFUSAL = /(?:do not|must not|should not|don'?t)\s+(?:merge|change|modify|deploy)\b/iu;
63: const CJK_ACTION_REFUSAL = /不要(?:修改|合并|部署)|不应(?:修改|合并|部署)|不能(?:改|合并|部署)|禁止(?:修改|合并|部署)|不具备部署|暂不部署/u;
64: 
65: function stripMarkdown(text: string): string {
66:   return text.replace(/[*_`]+/gu, " ").replace(/\s+/gu, " ").trim();
67: }
68: 
69: function leadingPolarity(text: string): "yes" | "no" | undefined {
70:   const trimmed = stripMarkdown(text);
```

## packages/benchmark/src/scoring/probe.ts:111-168

SHA256: `39fd231a7267b2ba5447e10448c03500cf62430ce360142cd0c725d5d856d2df`

```text
111: 
112: function fail(family: ProbeFamily, bucket: ProbeParseBucket, normalized = ""): ProbeScore {
113:   return { ok: false, skipped: bucket === "summary", normalized, family, bucket };
114: }
115: 
116: function basename(path: string): string {
117:   const parts = path.replace(/\\/gu, "/").split("/");
118:   return (parts.at(-1) ?? path).toLowerCase();
119: }
120: 
121: export function scoreProbe(input: {
122:   expected: string;
123:   observed: string;
124:   family: ProbeFamily;
125: }): ProbeScore {
126:   if (!input || typeof input !== "object") failMissing("input");
127:   if (typeof input.expected !== "string" || input.expected.length === 0) failInput("expected");
128:   if (typeof input.observed !== "string") failInput("observed");
129:   if (typeof input.family !== "string") failInput("family");
130:   const families: ProbeFamily[] = ["version", "yes-no", "path", "error", "deploy"];
131:   if (!families.includes(input.family)) failInput("family");
132:   if (input.observed.trim().length === 0) return fail(input.family, "non-answer");
133:   if (SUMMARY_MARKERS.some((marker) => marker.test(input.observed))) {
134:     return fail(input.family, "summary");
135:   }
136:   if (TOOL_CALL_MARKERS.some((marker) => marker.test(input.observed))) {
137:     return fail(input.family, "tool-call", input.observed.trim().slice(0, 80));
138:   }
139:   if (NON_ANSWER_MARKERS.some((marker) => marker.test(stripMarkdown(input.observed)))) {
140:     return fail(input.family, "non-answer", input.observed.trim().slice(0, 80));
141:   }
142:   const expected = normalizeProbeAnswer(input.expected, input.family);
143:   const observed = normalizeProbeAnswer(input.observed, input.family);
144:   if (input.family === "version" && /tu-\d+/iu.test(observed) && !/tu-\d+/iu.test(expected)) {
145:     return fail(input.family, "mismatch", observed);
146:   }
147:   if (input.family === "path") {
148:     const expectedName = basename(expected);
149:     const observedName = basename(observed);
150:     if (expectedName.length > 0 && observedName.length > 0 && expectedName !== observedName && !observed.includes(expected)) {
151:       return fail(input.family, "wrong-file", observed);
152:     }
153:   }
154:   if (input.family === "yes-no" && observed !== "yes" && observed !== "no") {
155:     return fail(input.family, /^\d/.test(observed) ? "unknown" : "unparseable", observed);
156:   }
157:   if (input.family === "deploy" && observed !== "must-not-deploy" && observed !== "deploy") {
158:     return fail(input.family, "unparseable", observed);
159:   }
160:   if (input.family === "version" && !/^\d+(?:\.\d+)*$/u.test(observed)) {
161:     return fail(input.family, "unparseable", observed);
162:   }
163:   const ok = input.family === "version" || input.family === "yes-no" || input.family === "deploy"
164:     ? observed === expected
165:     : observed === expected || observed.includes(expected);
166:   if (!ok) return fail(input.family, "mismatch", observed);
167:   return {
168:     ok: true,
```

## tests/live-gate/paired-w2-live.ts:880-958

SHA256: `b880dd2208089354eabb9abb9b6638b4cc5d196cd41a74d119d35396979a8739`

```text
880:   const completed = rows.filter((row) => row.b0.ok && row.b1.ok && row.b2.ok && row.f0.ok);
881:   const sameCut = completed.filter((row) => row.sameCut);
882:   const efficiencyRows = sameCut.filter((row) => !row.b0.budgetMismatch);
883:   const infraExcluded = rows.filter((row) => !row.b0.ok || !row.b1.ok || !row.b2.ok || !row.f0.ok).map((row) => row.id);
884:   const uniquePairCount = new Set(rows.map((row) => row.id)).size;
885:   const allPlannedRowsPresent = rows.length === expectedPairs && uniquePairCount === expectedPairs && infraExcluded.length === 0;
886:   const plannedMetric = (pick: (row: LivePairRow) => number) => rows.map((row) => {
887:     const value = pick(row);
888:     return Number.isFinite(value) ? value : 0;
889:   });
890: 
891:   const directiveCoverage = completed.every((row) => row.b2.directiveCoverage === 1) ? 1 : 0;
892:   const unsupported = completed.filter((row) => row.b2.unsupportedHighRiskOutcome > 0).length;
893:   const leaks = completed.filter((row) => row.b2.mustOmitLeak > 0).length;
894:   const nativeLeaks = completed.filter((row) => row.b0.mustOmitLeak > 0).length;
895:   const recovered = completed.length === 0 ? 0 : completed.filter((row) => row.b2.recovered).length / completed.length;
896:   const toolPairViolation = completed.reduce(
897:     (sum, row) => sum + row.b0.toolPairViolation + row.b1.toolPairViolation + row.b2.toolPairViolation + row.f0.toolPairViolation,
898:     0,
899:   );
900:   const b1FromHook = completed.every((row) => row.b1.fromExtension);
901:   const b2FromHook = completed.every((row) => row.b2.fromExtension);
902:   const b0Native = completed.every((row) => !row.b0.fromExtension);
903:   const f0Ceiling = completed.every((row) => !row.f0.fromExtension && row.f0.compactionCount === 0);
904:   const sameCutRate = completed.length === 0 ? 0 : sameCut.length / completed.length;
905:   const hardGatePass =
906:     allPlannedRowsPresent &&
907:     sameCutRate === 1 &&
908:     directiveCoverage === 1 &&
909:     unsupported === 0 &&
910:     leaks === 0 &&
911:     recovered === 1 &&
912:     toolPairViolation === 0 &&
913:     b1FromHook &&
914:     b2FromHook &&
915:     b0Native &&
916:     f0Ceiling;
917: 
918:   const quality = pairedOrZero(plannedMetric((row) => row.b0.quality), plannedMetric((row) => row.b2.quality));
919:   const polarity = pairedOrZero(plannedMetric((row) => row.b0.polarity), plannedMetric((row) => row.b2.polarity));
920:   const time = pairedOrZero(plannedMetric((row) => row.b0.time), plannedMetric((row) => row.b2.time));
921:   const update = pairedOrZero(plannedMetric((row) => row.b0.update), plannedMetric((row) => row.b2.update));
922:   const abstention = pairedOrZero(plannedMetric((row) => row.b0.abstention), plannedMetric((row) => row.b2.abstention));
923:   const closedLoop = pairedOrZero(plannedMetric((row) => row.b0.closedLoopSuccess), plannedMetric((row) => row.b2.closedLoopSuccess));
924:   const completeCaseQuality = pairedOrZero(completed.map((row) => row.b0.quality), completed.map((row) => row.b2.quality));
925:   const worstCaseQuality = pairedOrZero(
926:     rows.map((row) => row.b0.ok ? row.b0.quality : 1),
927:     rows.map((row) => row.b2.ok ? row.b2.quality : 0),
928:   );
929:   const diagnosticQuality = pairedOrZero(completed.map((row) => row.b0.quality), completed.map((row) => row.b1.quality));
930:   const containmentQuality = pairedOrZero(completed.map((row) => row.b0.quality), completed.map((row) => row.f0.quality));
931:   const constraintB0 = completed.reduce((sum, row) => sum + row.b0.constraintViolation, 0);
932:   const constraintB1 = completed.reduce((sum, row) => sum + row.b2.constraintViolation, 0);
933: 
934:   // Economics require an observed request input for both B0 and B2; never
935:   // substitute checkpoint summary tokens for missing provider/request data.
936:   const tokenBase = efficiencyRows.filter((row) => row.b0.probeInputTokens !== null && row.b2.probeInputTokens !== null);
937:   const tokenDeltas = tokenBase.map((row) =>
938:     relativeDelta(row.b2.probeInputTokens!, row.b0.probeInputTokens!),
939:   );
940:   const tokenMedianRelativeDelta = tokenDeltas.length > 0 ? median(tokenDeltas) : 0;
941:   const costB0 = tokenBase.filter((row) => row.b0.closedLoopSuccess === 1).map((row) => row.b0.probeInputTokens!);
942:   const costB1 = tokenBase.filter((row) => row.b2.closedLoopSuccess === 1).map((row) => row.b2.probeInputTokens!);
943:   const costPerSuccessRelativeDelta =
944:     costB0.length > 0 && costB1.length > 0 ? relativeDelta(median(costB1), median(costB0)) : 0;
945:   const overflow = completed.filter((row) => row.family === "overflow");
946:   const overflowB0 = overflow.filter((row) => row.b0.closedLoopSuccess === 1).length / Math.max(overflow.length, 1);
947:   const overflowB2 = overflow.filter((row) => row.b2.closedLoopSuccess === 1).length / Math.max(overflow.length, 1);
948:   const overflowQuality = pairedOrZero(
949:     overflow.map((row) => row.b0.quality),
950:     overflow.map((row) => row.b2.quality),
951:   );
952:   const realized = tokenBase.map(
953:     (row) => row.b0.probeInputTokens! - row.b2.probeInputTokens!,
954:   );
955:   const realizedNetMedian = realized.length > 0 ? median(realized) : 0;
956:   const budgetMismatchRate = completed.length === 0 ? 1 : completed.filter((row) => row.b0.budgetMismatch).length / completed.length;
957: 
958:   const sampleMeetsW2Gate = profile === "gate" && completed.length >= 300 && replicates === 3;
```

## tests/live-gate/paired-w2-live.ts:986-1010

SHA256: `b880dd2208089354eabb9abb9b6638b4cc5d196cd41a74d119d35396979a8739`

```text
986:   const byFamily = Object.fromEntries(
987:     families.map((family) => {
988:       const rowsF = completed.filter((row) => row.family === family);
989:       const n = rowsF.length;
990:       const mean = (pick: (row: LivePairRow) => number) => (n === 0 ? 0 : rowsF.reduce((sum, row) => sum + pick(row), 0) / n);
991:       const meanObserved = (pick: (row: LivePairRow) => number | null): number | null => {
992:         const values = rowsF.map(pick).filter((value): value is number => value !== null);
993:         return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
994:       };
995:       return [
996:         family,
997:         {
998:           n,
999:           sameCut: rowsF.filter((row) => row.sameCut).length,
1000:           b0ClosedLoop: rowsF.filter((row) => row.b0.closedLoopSuccess === 1).length,
1001:           b1ClosedLoop: rowsF.filter((row) => row.b1.closedLoopSuccess === 1).length,
1002:           b0QualityMean: mean((row) => row.b0.quality),
1003:           b1QualityMean: mean((row) => row.b1.quality),
1004:           b0ProbeInputMean: meanObserved((row) => row.b0.probeInputTokens),
1005:           b1ProbeInputMean: meanObserved((row) => row.b1.probeInputTokens),
1006:           b0SummaryTokensMean: mean((row) => row.b0.summaryTokens),
1007:           b1SummaryTokensMean: mean((row) => row.b1.summaryTokens),
1008:           b0MustOmitLeak: rowsF.filter((row) => row.b0.mustOmitLeak > 0).length,
1009:           b1MustOmitLeak: rowsF.filter((row) => row.b1.mustOmitLeak > 0).length,
1010:           b1DirectiveCoverage: mean((row) => row.b1.directiveCoverage),
```

## tests/tasks/t31.test.ts:259-302

SHA256: `dd19cfcc5d8dda34fae29056ecb6c26a8fadc4fbeb3ee0883532cb5461c6771f`

```text
259:       { abort() { aborted += 1; } },
260:     );
261:     expect(aborted).toBe(1);
262:     expect(result).toEqual({ cancel: true });
263:   });
264: 
265:   it("product extension does not rewrite directives to must-not or hardcoded heads", async () => {
266:     let handler: ((event: unknown, ctx: unknown) => Promise<{ compaction?: { summary: string; details: { directiveHead: string; claimHead: string; continuityHead: string } } } | undefined>) | undefined;
267:     const ext = createPiContextExtension({
268:       on(hook, next) {
269:         if (hook === "session_before_compact") handler = next as typeof handler;
270:       },
271:       registerTool() {},
272:       registerCommand() {},
273:       hasTool() { return false; },
274:     });
275:     const manager = SessionManager.inMemory(`${WORK}-product`);
276:     manager.appendMessage({ role: "user", content: "do not deploy production; 改为 version 7" } as never);
277:     const result = await handler!(
278:       {
279:         reason: "threshold",
280:         preparation: {
281:           tokensBefore: 8000,
282:           firstKeptEntryId: "entry-keep",
283:           allow: true,
284:           messagesToSummarize: [{ role: "user", content: "do not deploy production; 改为 version 7" }],
285:         },
286:       },
287:       {
288:         abort() {},
289:         cwd: manager.getCwd(),
290:         sessionManager: manager,
291:         model: { provider: "openclaw", id: "Qwen3.8-27B-WORK", contextWindow: 200192, maxTokens: 16384 },
292:       },
293:     );
294:     expect(result?.compaction).toBeDefined();
295:     expect(result?.compaction?.details.directiveHead).not.toBe("dh_runtime");
296:     expect(result?.compaction?.details.claimHead).not.toBe("ch_runtime");
297:     expect(result?.compaction?.details.continuityHead).not.toBe("cth_runtime");
298:     expect(result?.compaction?.summary.includes("must-not/active")).toBe(false);
299:     expect(result?.compaction?.summary.includes("do not deploy production")).toBe(true);
300:     expect(result?.compaction?.summary.includes("改为 version 7")).toBe(true);
301:     await ext.release?.();
302:   });
```
