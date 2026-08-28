import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createPiContextExtension } from "../../apps/pi-context-runtime/src/extension.js";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("packed install", () => {
  it("can load a packed dist/extension.js factory without private Pi imports", async () => {
    const staged = mkdtempSync(join(tmpdir(), "pcr-pack-"));
    mkdirSync(join(staged, "dist"), { recursive: true });
    const factory = [
      "export function createPiContextExtension(options = {}) {",
      "  return { name: 'pi-context-runtime', hooks: options.claimOnCreate ? { context() {} } : {}, claimed: Boolean(options.claimOnCreate) };",
      "}",
      "export default createPiContextExtension;",
    ].join("\n");
    writeFileSync(join(staged, "dist/extension.js"), factory);
    const loaded = await import(pathToFileURL(join(staged, "dist/extension.js")).href);
    expect(typeof loaded.default).toBe("function");
    expect(loaded.default().name).toBe("pi-context-runtime");

    const packedJs = readFileSync(join(staged, "dist/extension.js"), "utf8");
    expect(packedJs).not.toMatch(/@earendil-works\/pi-coding-agent\/(?:src|dist)\//);
    expect(packedJs).not.toMatch(/agent-loop/);

    const manifest = JSON.parse(readFileSync(join(repoRoot, "apps/pi-context-runtime/package.json"), "utf8")) as {
      pi: { extensions: string[] };
      peerDependencies: Record<string, string>;
    };
    expect(manifest.pi.extensions).toHaveLength(1);
    expect(manifest.peerDependencies["@earendil-works/pi-coding-agent"]).toBe("*");

    resetOwnerForTest();
    const live = createPiContextExtension({ claimOnCreate: true });
    expect(live.claimed).toBe(true);
    expect(Object.keys(live.hooks)).toEqual(expect.arrayContaining(["context", "session_before_compact", "agent_settled"]));
    live.release?.();
    resetOwnerForTest();
  });
});
