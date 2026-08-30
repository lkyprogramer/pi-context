import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { failInput, failMissing } from "./errors.js";
import type { CorpusCase, CorpusManifest, CorpusStore, CreateFileCorpusStoreInput } from "./types.js";

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function readJson(path: string, field: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    failInput(field);
  }
}

export function createFileCorpusStore(input: CreateFileCorpusStoreInput): CorpusStore {
  if (!input || typeof input !== "object") failMissing("input");
  if (typeof input.root !== "string" || input.root.length === 0) failMissing("root");
  if (typeof input.corpusId !== "string" || input.corpusId.length === 0) failMissing("corpusId");
  const casesPath = join(input.root, "cases.json");
  const manifestPath = join(input.root, "corpus.json");
  return {
    async list(): Promise<readonly CorpusCase[]> {
      const parsed = await readJson(casesPath, "cases.json");
      if (parsed === null) failInput("cases.json");
      if (!Array.isArray(parsed)) failInput("cases.json");
      return parsed as CorpusCase[];
    },
    async readManifest(): Promise<CorpusManifest | null> {
      const parsed = await readJson(manifestPath, "corpus.json");
      if (parsed === null) return null;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) failInput("corpus.json");
      return parsed as CorpusManifest;
    },
    async writeManifest(manifest: CorpusManifest): Promise<void> {
      if (!manifest || typeof manifest !== "object") failInput("manifest");
      const tmp = `${manifestPath}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
      await rename(tmp, manifestPath);
    },
  };
}
