import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { resolvePiJitiEntry } from "../live-gate/pi-resolve.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const hasPinnedPi = existsSync(join(homedir(), ".nvm/versions/node/v22.19.0/bin/pi"));

describe("jiti candidate load", () => {
  it.skipIf(!process.env.LIVE_PI && !hasPinnedPi)(
    "loads buildDeterministicCheckpointCandidate through Pi's jiti",
    async () => {
      const jitiUrl = pathToFileURL(resolvePiJitiEntry()).href;
      const { createJiti } = (await import(jitiUrl)) as {
        createJiti: (
          id: string,
          opts: { moduleCache: boolean },
        ) => { import: (path: string) => Promise<{ buildDeterministicCheckpointCandidate?: unknown }> };
      };
      const jiti = createJiti(import.meta.url, { moduleCache: false });
      const loaded = await jiti.import(join(repoRoot, "packages/kernel/src/compaction/candidate.ts"));
      expect(typeof loaded.buildDeterministicCheckpointCandidate).toBe("function");
    },
  );
});
