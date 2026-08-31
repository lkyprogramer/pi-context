import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hermeticModelsConfig, liveCredentialsMissingError } from "../../scripts/pack-smoke.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("hermetic Pi model fixture", () => {
  it("does not read the developer home for loader-only config", () => {
    const config = hermeticModelsConfig();
    expect(config.providers.openclaw.models[0].contextWindow).toBe(200192);
    const root = mkdtempSync(join(tmpdir(), "pcr-hermetic-"));
    roots.push(root);
    const serialized = `${JSON.stringify(config, null, 2)}\n`;
    expect(serialized.includes("/Users/")).toBe(false);
  });

  it("uses a fake model config with the production window", () => {
    const config = hermeticModelsConfig("openclaw", "openclaw/Qwen3.8-27B-WORK", 200192);
    expect(config.providers.openclaw.models[0].id).toBe("Qwen3.8-27B-WORK");
    expect(config.providers.openclaw.models[0].maxTokens).toBe(16384);
  });

  it("yields a typed skip error when live credentials are missing", () => {
    const error = liveCredentialsMissingError();
    expect(error).toMatchObject({ code: "PCR_LIVE_CREDENTIALS_MISSING" });
  });
});
