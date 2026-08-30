import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { generateSchemas } from "../../scripts/generate-schemas.mjs";

const temporaryDirectories: string[] = [];

async function createRepositoryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pcr-t03-"));
  temporaryDirectories.push(root);
  return root;
}

async function runT03Fixture() {
  const repositoryRoot = await createRepositoryRoot();
  const result = await generateSchemas({ repositoryRoot, outputDirectory: "schemas" });
  return { ok: result.files.length === 7, result, task: "T03" as const };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("T03 Canonical contracts and generated schemas", () => {
  it("canonical_contracts_and_generated_schemas", async () => {
    const fixture = await runT03Fixture();

    expect(fixture).toMatchObject({ ok: true, task: "T03" });
    expect(fixture.result).toMatchObject({ ok: true, task: "T03" });
    expect(fixture.result.files).toEqual([
      "checkpoint-v2.schema.json",
      "directive-record.schema.json",
      "evidence-receipt.schema.json",
      "runtime-config.schema.json",
      "runtime-cursor.schema.json",
      "source-class.schema.json",
      "user-turn-record.schema.json",
    ]);
    expect(new Set(Object.values(fixture.result.digests)).size).toBe(fixture.result.files.length);
  });

  it("generates exact source, directive, and offset vocabularies", async () => {
    const repositoryRoot = await createRepositoryRoot();
    await generateSchemas({ repositoryRoot, outputDirectory: "schemas" });
    const sourceClass = JSON.parse(await readFile(join(repositoryRoot, "schemas/source-class.schema.json"), "utf8"));
    const directive = JSON.parse(await readFile(join(repositoryRoot, "schemas/directive-record.schema.json"), "utf8"));

    expect(sourceClass.enum).toEqual([
      "system",
      "authenticated-user",
      "untrusted-user",
      "trusted-tool",
      "untrusted-tool",
      "external-content",
      "agent-derived",
    ]);
    expect(directive.required).toEqual(
      expect.arrayContaining(["kind", "polarity", "status", "utf8ByteRange", "utf16Range", "codePointRange"]),
    );
    expect(directive.properties.kind.enum).toEqual([
      "goal",
      "constraint",
      "prohibition",
      "correction",
      "permission",
      "format",
    ]);
  });

  it("links shared schemas without duplicating nested resource identifiers", async () => {
    const repositoryRoot = await createRepositoryRoot();
    await generateSchemas({ repositoryRoot, outputDirectory: "schemas" });
    const userTurn = JSON.parse(await readFile(join(repositoryRoot, "schemas/user-turn-record.schema.json"), "utf8"));
    const evidence = JSON.parse(await readFile(join(repositoryRoot, "schemas/evidence-receipt.schema.json"), "utf8"));
    const checkpoint = JSON.parse(await readFile(join(repositoryRoot, "schemas/checkpoint-v2.schema.json"), "utf8"));

    expect(userTurn.properties.cursor).toEqual({ $ref: "runtime-cursor.schema.json" });
    expect(evidence.properties.cursor).toEqual({ $ref: "runtime-cursor.schema.json" });
    expect(evidence.properties.sourceClass).toEqual({ $ref: "source-class.schema.json" });
    expect(checkpoint.properties.directives.items).toEqual({ $ref: "directive-record.schema.json" });
  });

  it("is idempotent for identical schema definitions", async () => {
    const repositoryRoot = await createRepositoryRoot();
    const first = await generateSchemas({ repositoryRoot, outputDirectory: "schemas" });
    const second = await generateSchemas({ repositoryRoot, outputDirectory: "schemas" });

    expect(second).toEqual(first);
  });

  it("atomically repairs a modified generated schema", async () => {
    const repositoryRoot = await createRepositoryRoot();
    const first = await generateSchemas({ repositoryRoot, outputDirectory: "schemas" });
    await writeFile(join(repositoryRoot, "schemas/source-class.schema.json"), "{}\n", "utf8");

    const repaired = await generateSchemas({ repositoryRoot, outputDirectory: "schemas" });

    expect(repaired).toEqual(first);
    expect(JSON.parse(await readFile(join(repositoryRoot, "schemas/source-class.schema.json"), "utf8")).enum).toHaveLength(7);
  });

  it("rejects output outside the repository scope", async () => {
    const repositoryRoot = await createRepositoryRoot();

    await expect(generateSchemas({ repositoryRoot, outputDirectory: "../schemas" })).rejects.toThrow(
      "schema output is outside repository scope",
    );
  });

  it("fails without replacing a non-directory output target", async () => {
    const repositoryRoot = await createRepositoryRoot();
    await writeFile(join(repositoryRoot, "schemas"), "occupied\n", "utf8");

    await expect(generateSchemas({ repositoryRoot, outputDirectory: "schemas" })).rejects.toThrow();
    expect(await readFile(join(repositoryRoot, "schemas"), "utf8")).toBe("occupied\n");
  });

  it("replays deterministically across independent repositories", async () => {
    const firstRoot = await createRepositoryRoot();
    const secondRoot = await createRepositoryRoot();

    const first = await generateSchemas({ repositoryRoot: firstRoot, outputDirectory: "schemas" });
    const second = await generateSchemas({ repositoryRoot: secondRoot, outputDirectory: "schemas" });

    expect(second.files).toEqual(first.files);
    expect(second.digests).toEqual(first.digests);
  });
});
