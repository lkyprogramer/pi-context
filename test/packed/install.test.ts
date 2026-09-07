import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import register from "../../src/extension.js";
import { createPlugin, setProfile } from "../../src/plugin.js";
import { renderMessages } from "../../src/projection/render.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("T19 packed install", () => {
  it("observe does not rewrite provider messages and schema stays stable across profile switches", () => {
    const messages = [{ role: "user", content: [{ type: "text", text: "hello" }] }];
    const out = renderMessages({ messages, plan: null, profile: "observe", optionalBudget: 100 });
    expect(out.messages).toBe(messages);
    const state = createPlugin();
    setProfile(state, "balanced");
    setProfile(state, "observe");
    expect(state.config.history.searchLimit).toBe(8);
  });

  it("does not forge pin confirmation without UI", async () => {
    const notes: string[] = [];
    const pi = {
      on() {},
      registerTool() {},
      registerCommand(_n: string, spec: { handler: (args: string, ctx: Record<string, unknown>) => Promise<void> }) {
        void spec.handler("pin e 0 0 1", {
          hasUI: false,
          ui: { notify: (m: string) => notes.push(m) },
        });
      },
    };
    register(pi);
    await new Promise((r) => setTimeout(r, 0));
    expect(notes.join(" ")).toMatch(/not forged|requires an interactive/);
  });

  it("packed dist has no PCR ingress contract or tests", () => {
    execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], { cwd: repoRoot, stdio: "pipe" });
    const js = readFileSync(join(repoRoot, "dist/extension.js"), "utf8");
    expect(js).not.toMatch(/PCR_INGRESS_METADATA_CONTRACT/);
    expect(existsSync(join(repoRoot, "dist/testing.js"))).toBe(false);
  });
});
