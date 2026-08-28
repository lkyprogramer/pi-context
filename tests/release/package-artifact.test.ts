import { describe, expect, it } from "vitest";
import { inspectPackedRelease } from "./support.js";

describe("release package", () => {
  it("contains one extension entry, runtime dependencies and no source-private imports", async () => {
    const artifact = await inspectPackedRelease();
    expect(artifact.piExtensions).toEqual(["./dist/extension.js"]);
    expect(artifact.privatePiImports).toEqual([]);
    expect(artifact.manifestVerified).toBe(true);
  });

  it("verifies clean-home extract, uninstall/reinstall, and temporary pi -e entry", async () => {
    const artifact = await inspectPackedRelease();
    expect(artifact.cleanHome.extracted).toBe(true);
    expect(artifact.cleanHome.uninstalled).toBe(true);
    expect(artifact.cleanHome.reinstalled).toBe(true);
    expect(artifact.temporaryPiE).toEqual({ entry: "./dist/extension.js", loaded: true });
    expect(artifact.rollback[0]).toMatch(/pi remove/);
  });

  it("keeps the Node/OS matrix and does not hide unsupported Pi versions", async () => {
    const artifact = await inspectPackedRelease();
    expect(artifact.nodeMatrix).toEqual(["22.19.0", "24.18.1", "26.5.1"]);
    expect(artifact.supportedRange).toBe(">=0.84.3 <0.85.0");
    expect(artifact.unsupportedHidden).toBe(false);
  });

  it("ships license/security docs and the gate-derived semantic default", async () => {
    const artifact = await inspectPackedRelease();
    expect(artifact.semanticDefault).toBe("off");
    expect(artifact.t45Decision).toBe("stop-at-deterministic-slice");
    expect(artifact.publicationClaim).toBe(false);
    expect(artifact.secrets).toEqual([]);
    expect(artifact.version).toBe("0.1.0-alpha.1");
    expect(artifact.size).toBeGreaterThan(0);
  });
});
