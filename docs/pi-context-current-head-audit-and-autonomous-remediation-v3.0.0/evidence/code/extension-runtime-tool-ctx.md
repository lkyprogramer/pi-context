# apps/pi-context-runtime/src/extension.ts:420-455

```text
  420:     },
  421:     evidence: deferredEvidence,
  422:     claimed: true,
  423:     resolve: (ctx) => userTurns.resolveTools(ctx),
  424:     commands: {
  425:       status: async (ctx) => {
  426:         try {
  427:           const bound = await userTurns.resolveTools(ctx);
  428:           return JSON.stringify({ ok: true, command: "context", workspaceId: bound.cursor.workspaceId, claimed: true });
  429:         } catch {
  430:           return JSON.stringify({ ok: false, command: "context", code: "PCR_RETRIEVAL_DEPENDENCY_MISSING" });
  431:         }
  432:       },
  433:       doctor: async (ctx) => {
  434:         const bound = await userTurns.resolveTools(ctx).catch(() => undefined);
  435:         const workspaceId = bound?.cursor.workspaceId ?? userTurns.lastWorkspaceId() ?? ctx.workspaceId;
  436:         if (!workspaceId) {
  437:           throw Object.assign(new Error("PCR_RUNTIME_TOOLS_CURSOR_MISSING"), { code: "PCR_RUNTIME_TOOLS_CURSOR_MISSING" });
  438:         }
  439:         const dataRoot = typeof ctx.cwd === "string" && ctx.cwd.length > 0 ? ctx.cwd : process.cwd();
  440:         return JSON.stringify({
  441:           command: "context-doctor",
  442:           workspaceId,
  443:           ...(await runRuntimeDoctor(
  444:             {
  445:               packages: [],
  446:               nodeVersion: process.versions.node,
  447:               piVersion: "0.84.4",
  448:               capabilities: REQUIRED_PI_CAPABILITIES.filter((name) => name !== "agent_settled" || semanticBeta),
  449:               trusted: true,
  450:               dataRoot,
  451:             },
  452:             { conflictPolicy: "strict" },
  453:           )),
  454:         });
  455:       },
```
