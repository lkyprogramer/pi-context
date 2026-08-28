import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createPiContextExtension, register } from "../../apps/pi-context-runtime/src/extension.js";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const distEntry = join(repoRoot, "apps/pi-context-runtime/dist/extension.js");

afterEach(resetOwnerForTest);

function fakeHost() {
  const hooks: Record<string, unknown> = {};
  const tools = new Set<string>();
  const commands = new Set<string>();
  return {
    hooks,
    tools,
    commands,
    api: {
      on(hook: string, handler: unknown) {
        hooks[hook] = handler;
      },
      registerTool(tool: { name: string }) {
        tools.add(tool.name);
      },
      registerCommand(name: string) {
        commands.add(name);
      },
      hasTool(name: string) {
        return tools.has(name);
      },
    },
  };
}

describe("Pi factory entry", () => {
  it("registers handlers onto the host ExtensionAPI and does not start a worker", () => {
    const host = fakeHost();
    const ext = createPiContextExtension(host.api);
    expect(ext.claimed).toBe(true);
    expect(host.hooks).toEqual(
      expect.objectContaining({
        context: expect.any(Function),
        session_before_compact: expect.any(Function),
        session_compact: expect.any(Function),
        session_compact_failed: expect.any(Function),
        session_start: expect.any(Function),
        agent_settled: expect.any(Function),
      }),
    );
    expect([...host.tools]).toEqual(
      expect.arrayContaining(["context_recall", "context_search", "context_status", "context_pin"]),
    );
    expect([...host.commands]).toEqual(
      expect.arrayContaining(["context", "context-doctor", "context-compact"]),
    );
    ext.release?.();
  });

  it("exposes register(pi) and a committed dist/extension.js factory entry", () => {
    expect(existsSync(distEntry)).toBe(true);
    const source = readFileSync(distEntry, "utf8");
    expect(source).toMatch(/from ["']\.\.\/src\/extension\.ts["']/);
    expect(source).not.toMatch(/@earendil-works\/pi-coding-agent\/(?:src|dist)\//);
    expect(source).not.toMatch(/agent-loop/);
    const host = fakeHost();
    const ext = register(host.api);
    expect(host.hooks.context).toEqual(expect.any(Function));
    ext.release?.();
  });
});
