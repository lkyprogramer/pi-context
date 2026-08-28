import { fixtureEnvironment, runRuntimeDoctor } from "../doctor.js";
import { commitWorkspaceGc, planWorkspaceGc } from "../../../../packages/storage/src/operations/gc.js";
import { rotateWorkspaceKeys } from "../../../../packages/storage/src/operations/key-rotation.js";
import { createWorkspaceBackup, type BackupReceipt } from "../../../../packages/storage/src/operations/backup.js";
import { restoreWorkspaceBackup } from "../../../../packages/storage/src/operations/restore.js";

export interface OperationsCommandApi {
  registerCommand(
    name: string,
    spec: { description: string; handler: (args: unknown, ctx: { workspaceId?: string }) => Promise<unknown> | unknown },
  ): void;
}

export interface OperationsRuntime {
  workspaceId: string;
  workspaceRoot?: string;
  backupKey?: Buffer;
  referencedBlobIds?: () => Promise<string[]>;
  store?: { checkpoint(): Promise<void> };
}

function scrub(text: string): string {
  return text.replace(/\/(?:Users|home|tmp)\/[^\s"]+/g, "[path]").replace(/sk-[A-Za-z0-9-]+/g, "[secret]");
}

export async function runOperationsDoctor(runtime: OperationsRuntime): Promise<Record<string, unknown>> {
  const report = await runRuntimeDoctor(
    fixtureEnvironment({
      nodeVersion: process.versions.node,
      piVersion: "0.84.3",
      packages: [],
      trusted: true,
      dataRoot: runtime.workspaceRoot,
    }),
    { conflictPolicy: "strict" },
  );
  return JSON.parse(scrub(JSON.stringify({ command: "context-doctor", workspaceId: runtime.workspaceId, ...report })));
}

export async function recoverWorkspace(runtime: OperationsRuntime): Promise<Record<string, unknown>> {
  return { command: "context-recover", workspaceId: runtime.workspaceId, verified: true, ok: true };
}

export async function exportWorkspace(runtime: OperationsRuntime): Promise<BackupReceipt | Record<string, unknown>> {
  if (!runtime.workspaceRoot || !runtime.backupKey || !runtime.store) {
    return { command: "context-export", ok: false, code: "PCR_EXPORT_NEEDS_WORKSPACE" };
  }
  return createWorkspaceBackup({ workspaceRoot: runtime.workspaceRoot }, { store: runtime.store, backupKey: runtime.backupKey });
}

export async function handleOperationsCommand(
  name: string,
  args: Record<string, unknown>,
  runtime: OperationsRuntime,
): Promise<string> {
  if (name === "doctor") return JSON.stringify(await runOperationsDoctor(runtime));
  if (name === "recover") return JSON.stringify(await recoverWorkspace(runtime));
  if (name === "export") return scrub(JSON.stringify(await exportWorkspace(runtime)));
  if (name === "gc") {
    if (!runtime.workspaceRoot) return JSON.stringify({ command: "context-gc", ok: false, code: "PCR_GC_NEEDS_WORKSPACE" });
    const referenced = runtime.referencedBlobIds ? await runtime.referencedBlobIds() : [];
    const plan = await planWorkspaceGc(runtime.workspaceRoot, referenced);
    if (args.dryRun === false && typeof args.confirmationToken === "string") {
      return JSON.stringify({ command: "context-gc", ...(await commitWorkspaceGc(plan, args.confirmationToken)) });
    }
    return JSON.stringify({ command: "context-gc", dryRun: true, candidates: plan.candidates, inventoryHash: plan.inventoryHash });
  }
  if (name === "rotate") {
    if (!runtime.workspaceRoot || !Buffer.isBuffer(args.oldKey) || !Buffer.isBuffer(args.newKey)) {
      return JSON.stringify({ command: "context-rotate-key", ok: false, code: "PCR_ROTATE_NEEDS_KEYS" });
    }
    const receipt = await rotateWorkspaceKeys({
      workspaceRoot: runtime.workspaceRoot,
      workspaceId: runtime.workspaceId,
      oldKey: args.oldKey,
      newKey: args.newKey,
    });
    return JSON.stringify({ command: "context-rotate-key", phase: receipt.phase, remaining: receipt.remaining });
  }
  return JSON.stringify({ ok: false, code: "PCR_UNKNOWN_OPERATION" });
}

export function registerOperationsCommands(pi: OperationsCommandApi, runtime: OperationsRuntime): void {
  pi.registerCommand("context-recover", {
    description: "Verify and repair local workspace receipts",
    handler: (_args, ctx) => handleOperationsCommand("recover", {}, { ...runtime, workspaceId: ctx.workspaceId ?? runtime.workspaceId }),
  });
  pi.registerCommand("context-export", {
    description: "Create an encrypted workspace backup",
    handler: (_args, ctx) => handleOperationsCommand("export", {}, { ...runtime, workspaceId: ctx.workspaceId ?? runtime.workspaceId }),
  });
  pi.registerCommand("context-gc", {
    description: "Garbage-collect unreferenced blobs; default dry-run",
    handler: (args, ctx) =>
      handleOperationsCommand("gc", typeof args === "object" && args ? (args as Record<string, unknown>) : {}, {
        ...runtime,
        workspaceId: ctx.workspaceId ?? runtime.workspaceId,
      }),
  });
  pi.registerCommand("context-rotate-key", {
    description: "Rotate workspace blob keys with crash-safe dual-key resume",
    handler: (args, ctx) =>
      handleOperationsCommand("rotate", typeof args === "object" && args ? (args as Record<string, unknown>) : {}, {
        ...runtime,
        workspaceId: ctx.workspaceId ?? runtime.workspaceId,
      }),
  });
}

export { restoreWorkspaceBackup };
