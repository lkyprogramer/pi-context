import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { register as registerProductExtension } from "../../apps/pi-context-runtime/src/extension.js";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";

const roots: string[] = [];

afterEach(() => {
  resetOwnerForTest();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function host() {
  const hooks = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
  return {
    hooks,
    api: {
      on(name: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) {
        hooks.set(name, handler);
      },
      registerTool() {},
      registerCommand() {},
      hasTool() { return false; },
    },
  };
}

describe("unbound scope failure", () => {
  it("does not persist unbound session or model fallbacks", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-scope-failure-"));
    roots.push(root);
    const { hooks, api } = host();
    registerProductExtension(api as never);

    const context = hooks.get("context");
    const compact = hooks.get("session_before_compact");
    expect(context).toBeTypeOf("function");
    const messages = [{ role: "user", content: "hello" }];
    await expect(context?.({ messages }, { abort() {}, cwd: root })).resolves.toEqual({ messages });

    const decision = await compact?.({
      reason: "threshold",
      preparation: { tokensBefore: 100, firstKeptEntryId: "e1" },
    }, { abort() {}, cwd: root, signal: undefined });
    expect(decision === undefined || decision === null || typeof decision === "object").toBe(true);

    const sqliteFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".sqlite")) sqliteFiles.push(path);
      }
    };
    walk(root);
    expect(sqliteFiles).toEqual([]);
  });

  it("fails closed when lineage or model is missing on lifecycle", async () => {
    const { hooks, api } = host();
    registerProductExtension(api as never);
    const start = hooks.get("session_start");
    await expect(start?.({}, { cwd: "/tmp/pcr-missing-identity", abort() {} })).rejects.toBeTruthy();
  });
});
