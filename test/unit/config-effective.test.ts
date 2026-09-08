import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, parseConfig } from "../../src/config.js";

const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

function isolatedHome(): string {
  const home = mkdtempSync(join(tmpdir(), "pctx-home-"));
  process.env.HOME = home;
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  return home;
}

describe("A01 effective config", () => {
  it("a trusted project pctx.json switches the effective profile to balanced", () => {
    isolatedHome();
    const cwd = mkdtempSync(join(tmpdir(), "pctx-cfg-"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(join(cwd, ".pi", "pctx.json"), JSON.stringify({ schemaVersion: 6, profile: "balanced" }));
    const loaded = loadConfig(cwd, true);
    expect(loaded.config.profile).toBe("balanced");
    expect(loaded.config.fold.triggerPercent).toBe(60);
    expect(loaded.source).toBe(join(cwd, ".pi", "pctx.json"));
    expect(loadConfig(cwd, false).config.profile).toBe("observe");
  });

  it("rejects legacy schemaVersion 5 fields with a migration message", () => {
    expect(() => parseConfig({ schemaVersion: 5, profile: "observe", semantic: { enabled: true } })).toThrow(
      /schemaVersion 6|remove semantic/,
    );
  });

  it("ignores untrusted project pctx.json and warns", () => {
    isolatedHome();
    const cwd = mkdtempSync(join(tmpdir(), "pctx-untrusted-"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(join(cwd, ".pi", "pctx.json"), JSON.stringify({ schemaVersion: 6, profile: "balanced" }));
    const loaded = loadConfig(cwd, false);
    expect(loaded.config.profile).toBe("observe");
    expect(loaded.warnings).toContain("untrusted-project-config");
    expect(loaded.source).not.toBe(join(cwd, ".pi", "pctx.json"));
  });

  it("rejects fold.triggerPercent at or above 85", () => {
    expect(() => parseConfig({ schemaVersion: 6, fold: { triggerPercent: 90 } })).toThrow(/PCTX_CONFIG|triggerPercent|CONFIG/);
  });

  it("rejects telemetry.includeContent=true", () => {
    expect(() => parseConfig({ schemaVersion: 6, telemetry: { includeContent: true } })).toThrow(
      /PCTX_CONFIG|includeContent|CONFIG/,
    );
  });

  it("warns ignored-legacy-config when only pctx-v5.json exists", () => {
    const home = isolatedHome();
    writeFileSync(
      join(home, ".pi", "agent", "pctx-v5.json"),
      JSON.stringify({ schemaVersion: 5, profile: "balanced" }),
    );
    const loaded = loadConfig(mkdtempSync(join(tmpdir(), "pctx-legacy-")), false);
    expect(loaded.config.profile).toBe("observe");
    expect(loaded.warnings).toContain("ignored-legacy-config");
    expect(loaded.source).toBe("default");
    expect(homedir()).toBe(home);
  });
});
