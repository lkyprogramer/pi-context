# apps/pi-context-runtime/src/composition-root.ts:1265-1450

```text
 1265:   });
 1266: 
 1267:   const close = async (): Promise<void> => {
 1268:     const pending = [...owners.values()];
 1269:     owners.clear();
 1270:     const settled = await Promise.allSettled(pending.map(async (owner) => (await owner).close()));
 1271:     const rejected = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
 1272:     if (rejected) throw rejected.reason;
 1273:   };
 1274:   pi.on("session_shutdown", async (event, ctx) => {
 1275:     const host = (ctx && typeof ctx === "object" && "sessionManager" in ctx)
 1276:       ? ctx as ExtensionContext
 1277:       : (event && typeof event === "object" && "sessionManager" in event)
 1278:         ? event as ExtensionContext
 1279:         : undefined;
 1280:     if (!host) {
 1281:       throw Object.assign(new Error("PCR_SESSION_SHUTDOWN_CURSOR_INVALID"), {
 1282:         code: "PCR_SESSION_SHUTDOWN_CURSOR_INVALID",
 1283:       });
 1284:     }
 1285:     let cursor: RuntimeCursor;
 1286:     try {
 1287:       cursor = cursorFromContext(host);
 1288:     } catch (error) {
 1289:       throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
 1290:         code: "PCR_SESSION_SHUTDOWN_CURSOR_INVALID",
 1291:       });
 1292:     }
 1293:     const opening = await ownerByWorkspace(cursor.workspaceId);
 1294:     if (!opening) return;
 1295:     const closing: RuntimeSession[] = [];
 1296:     for (const [key, session] of opening.sessions) {
 1297:       const parsed = JSON.parse(key) as [string, string];
 1298:       if (parsed[0] === cursor.workspaceId && parsed[1] === cursor.sessionId) {
 1299:         opening.sessions.delete(key);
 1300:         closing.push(session);
 1301:       }
 1302:     }
 1303:     opening.cursorsBySession.delete(cursor.sessionId);
 1304:     await Promise.all(closing.map((session) => session.close?.() ?? Promise.resolve()));
 1305:     if (opening.sessions.size === 0) {
 1306:       owners.delete(cursor.workspaceId);
 1307:       await opening.close();
 1308:     }
 1309:   });
 1310:   return Object.freeze({
 1311:     hook,
 1312:     close,
 1313:     lastWorkspaceId() {
 1314:       if (owners.size !== 1) return undefined;
 1315:       return [...owners.keys()][0];
 1316:     },
 1317:     async lastRequestUsage(workspaceId) {
 1318:       const opening = workspaceId
 1319:         ? owners.get(workspaceId)
 1320:         : (owners.size === 1 ? [...owners.values()][0] : undefined);
 1321:       if (!opening) return undefined;
 1322:       return (await opening).lastUsage;
 1323:     },
 1324:     async lastSnapshotHash(workspaceId) {
 1325:       const opening = workspaceId
 1326:         ? owners.get(workspaceId)
 1327:         : (owners.size === 1 ? [...owners.values()][0] : undefined);
 1328:       if (!opening) return undefined;
 1329:       const owner = await opening;
 1330:       if (owner.snapshotHashByCursor.size === 1) return [...owner.snapshotHashByCursor.values()][0];
 1331:       return owner.lastRuntimeSnapshotHash;
 1332:     },
 1333:     lastPointers() {
 1334:       const collected: Array<{ ref: string; kind: string }> = [];
 1335:       for (const pending of owners.values()) {
 1336:         void pending;
 1337:       }
 1338:       return collected;
 1339:     },
 1340:     async ensure(ctx: ExtensionContext) {
 1341:       const cursor = cursorFromContext(ctx);
 1342:       const owner = await ownerFor(cursor, ctx);
 1343:       await sessionFor(owner, cursor, ctx);
 1344:     },
 1345:     async openSession(ctx: PiSessionContext) {
 1346:       if (ctx.sessionId === "unbound" || ctx.modelKey === "unbound") {
 1347:         throw new ProductionCompositionError("PCR_PI_SESSION_CONTEXT_INVALID", { field: "sessionId" });
 1348:       }
 1349:       const opening = await ownerByWorkspace(ctx.workspaceId);
 1350:       if (!opening) {
 1351:         throw new ProductionCompositionError("PCR_PRODUCTION_DEPENDENCY_MISSING", { dependency: "workspaceOwner" });
 1352:       }
 1353:       const cursor: RuntimeCursor = {
 1354:         workspaceId: ctx.workspaceId,
 1355:         sessionId: ctx.sessionId,
 1356:         leafId: ctx.leafId,
 1357:         lineageHash: ctx.lineageHash,
 1358:         modelKey: ctx.modelKey,
 1359:       };
 1360:       return sessionFor(opening, cursor);
 1361:     },
 1362:     async recover(input: SessionStart) {
 1363:       const opening = await ownerByWorkspace(input.cursor.workspaceId);
 1364:       if (!opening) {
 1365:         throw new ProductionCompositionError("PCR_PRODUCTION_DEPENDENCY_MISSING", { dependency: "workspaceOwner" });
 1366:       }
 1367:       await sessionFor(opening, input.cursor);
 1368:       const recovery = createRecoveryService({
 1369:         cursor: input.cursor,
 1370:         sessions: {
 1371:           async open() { return opening.sessions.get(cursorKey(input.cursor)); },
 1372:           async close(sessionId) {
 1373:             const bound = opening.cursorsBySession.get(sessionId);
 1374:             if (!bound) return;
 1375:             opening.sessions.delete(cursorKey(bound));
 1376:           },
 1377:         },
 1378:         journal: { reconcile: (snapshot) => opening.saga.reconcile(snapshot) },
 1379:         candidates: {
 1380:           async invalidate(scope, reason, signal) {
 1381:             return opening.candidates.invalidateScope?.(scope, reason, signal) ?? 0;
 1382:           },
 1383:         },
 1384:       });
 1385:       return recovery.onSessionStart(input);
 1386:     },
 1387:     async branchChanged(input: BranchChange) {
 1388:       const opening = await ownerByWorkspace(input.cursor.workspaceId);
 1389:       if (!opening) {
 1390:         throw new ProductionCompositionError("PCR_PRODUCTION_DEPENDENCY_MISSING", { dependency: "workspaceOwner" });
 1391:       }
 1392:       await sessionFor(opening, input.cursor);
 1393:       const recovery = createRecoveryService({
 1394:         cursor: input.cursor,
 1395:         sessions: {
 1396:           async open() { return opening.sessions.get(cursorKey(input.cursor)); },
 1397:           async close(sessionId) {
 1398:             const bound = opening.cursorsBySession.get(sessionId);
 1399:             if (!bound) return;
 1400:             opening.sessions.delete(cursorKey(bound));
 1401:           },
 1402:         },
 1403:         journal: { reconcile: (snapshot) => opening.saga.reconcile(snapshot) },
 1404:         candidates: {
 1405:           async invalidate(scope, reason, signal) {
 1406:             return opening.candidates.invalidateScope?.(scope, reason, signal) ?? 0;
 1407:           },
 1408:         },
 1409:       });
 1410:       await recovery.onBranchChange(input);
 1411:     },
 1412:     async closeSession(cursor: RuntimeCursor) {
 1413:       const opening = await ownerByWorkspace(cursor.workspaceId);
 1414:       if (!opening) return;
 1415:       const session = opening.sessions.get(cursorKey(cursor));
 1416:       opening.sessions.delete(cursorKey(cursor));
 1417:       opening.cursorsBySession.delete(cursor.sessionId);
 1418:       await session?.close?.();
 1419:     },
 1420:     async stageCompaction(input) {
 1421:       const opening = await ownerByWorkspace(input.cursor.workspaceId);
 1422:       if (!opening) return;
 1423:       await opening.compactionJournal.stage({
 1424:         cursor: input.cursor,
 1425:         outputHash: input.outputHash,
 1426:         firstKeptEntryId: input.firstKeptEntryId,
 1427:         payloadJson: input.payloadJson,
 1428:         now: clock.now(),
 1429:       });
 1430:     },
 1431:     async ackCompaction(input) {
 1432:       const opening = await ownerByWorkspace(input.cursor.workspaceId);
 1433:       if (!opening) return;
 1434:       await opening.compactionJournal.ack(input);
 1435:     },
 1436:     async pendingCompaction(cursor) {
 1437:       const opening = await ownerByWorkspace(cursor.workspaceId);
 1438:       if (!opening) return null;
 1439:       return opening.compactionJournal.pending(cursor);
 1440:     },
 1441:     async failStagedCompaction(cursor) {
 1442:       const opening = await ownerByWorkspace(cursor.workspaceId);
 1443:       if (!opening) return;
 1444:       await opening.compactionJournal.fail({ cursor });
 1445:     },
 1446:     async persistBackgroundCandidate(input: {
 1447:       workspaceId: string;
 1448:       sessionId: string;
 1449:       leafId: string | null;
 1450:       lineageHash: string;
```
