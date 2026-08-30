import { beforeAll, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { installAndRunVerticalProbe, packCurrentSource } from "../../scripts/pack-smoke.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
let packed: Awaited<ReturnType<typeof packCurrentSource>>;

describe("T06 Real npm pack and clean Pi install harness", () => {
  beforeAll(async () => {
    packed = await packCurrentSource({ repoRoot });
  });

  it(
    "loads the actual packed tarball in an empty Pi home",
    async () => {
      const tempRoot = mkdtempSync(join(tmpdir(), "pcr-t06-test-success-"));
      const result = await installAndRunVerticalProbe(packed, { repoRoot, tempRoot });

      expect(result).toMatchObject({
        loaded: true,
        verticalProbePassed: true,
        cleanHomeRemoved: true,
        piVersion: "0.84.4",
        model: {
          provider: "openclaw",
          modelId: "openclaw/Qwen3.8-27B-WORK",
          contextWindow: 200192,
          maxTokens: 16384,
        },
        missingHooks: [],
        behavior: { contextPassed: true, toolPassed: true, compactionPassed: true },
      });
      expect(readdirSync(tempRoot)).toEqual([]);
    },
    30_000,
  );

  it("rejects a modified tarball receipt before installation", async () => {
    await expect(
      installAndRunVerticalProbe({ ...packed, sha256: "0".repeat(64) }, { repoRoot }),
    ).rejects.toThrow("digest mismatch");
  });

  it("rejects a repository scope without the runtime source", async () => {
    await expect(packCurrentSource({ repoRoot: dirname(repoRoot) })).rejects.toThrow(
      "does not contain pi-context-runtime source",
    );
  });

  it("fails closed when packing is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(packCurrentSource({ repoRoot, signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("packs deterministically from the same committed source", async () => {
    const replay = await packCurrentSource({ repoRoot });

    expect(replay.sha256).toBe(packed.sha256);
    expect(replay).toMatchObject({
      packageName: "pi-context-runtime",
      packageVersion: "0.1.0-alpha.1",
      entry: "./dist/extension.js",
      packagePolicy: { private: true, license: "UNLICENSED" },
    });
  });

  it(
    "isolates duplicate probes while preserving their observable contract",
    async () => {
      const tempRoot = mkdtempSync(join(tmpdir(), "pcr-t06-test-duplicate-"));
      const first = await installAndRunVerticalProbe(packed, { repoRoot, tempRoot });
      const second = await installAndRunVerticalProbe(packed, { repoRoot, tempRoot });

      expect(second.isolationId).not.toBe(first.isolationId);
      expect(second.handlers).toEqual(first.handlers);
      expect(second.model).toEqual(first.model);
      expect(second.verticalProbePassed).toBe(true);
      expect(readdirSync(tempRoot)).toEqual([]);
    },
    30_000,
  );

  it("aborts in-flight work and removes the isolated home", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pcr-t06-test-abort-"));
    const controller = new AbortController();
    const pending = installAndRunVerticalProbe(packed, { repoRoot, tempRoot, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it("kills a timed-out process tree and removes the isolated home", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pcr-t06-test-timeout-"));
    const binRoot = mkdtempSync(join(tmpdir(), "pcr-t06-fake-pi-"));
    const piBin = join(binRoot, "pi");
    writeFileSync(piBin, "#!/bin/sh\ntrap '' TERM\nsleep 30\n");
    chmodSync(piBin, 0o700);

    await expect(
      installAndRunVerticalProbe(packed, { repoRoot, tempRoot, piBin, commandTimeoutMs: 100 }),
    ).rejects.toThrow("timed out after 100ms");
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it("propagates a non-zero Pi exit and removes the isolated home", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pcr-t06-test-nonzero-"));
    const binRoot = mkdtempSync(join(tmpdir(), "pcr-t06-fake-pi-"));
    const piBin = join(binRoot, "pi");
    writeFileSync(piBin, "#!/bin/sh\nprintf 'intentional failure' >&2\nexit 7\n");
    chmodSync(piBin, 0o700);

    await expect(
      installAndRunVerticalProbe(packed, { repoRoot, tempRoot, piBin, commandTimeoutMs: 5_000 }),
    ).rejects.toThrow("intentional failure");
    expect(readdirSync(tempRoot)).toEqual([]);
  });
});
