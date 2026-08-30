#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CANONICAL_SCHEMA_ENTRIES } from "../packages/contracts/schema-definitions.mjs";

function render(schema) {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

function digest(content) {
  return createHash("sha256").update(content).digest("hex");
}

function validateEntries(entries) {
  const names = new Set();
  const identifiers = new Set();
  for (const [name, schema] of entries) {
    if (typeof name !== "string" || !/^[a-z0-9-]+\.schema\.json$/u.test(name)) {
      throw new TypeError(`invalid schema filename: ${String(name)}`);
    }
    if (names.has(name)) throw new Error(`duplicate schema filename: ${name}`);
    if (!schema || typeof schema !== "object" || typeof schema.$id !== "string") {
      throw new TypeError(`schema ${name} is missing $id`);
    }
    if (identifiers.has(schema.$id)) throw new Error(`duplicate schema $id: ${schema.$id}`);
    names.add(name);
    identifiers.add(schema.$id);
  }
}

async function outputMatches(outputDirectory, rendered) {
  let names;
  try {
    names = (await readdir(outputDirectory)).sort();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  if (names.length !== rendered.size || names.some((name) => !rendered.has(name))) return false;
  const contents = await Promise.all(names.map((name) => readFile(resolve(outputDirectory, name), "utf8")));
  return contents.every((content, index) => content === rendered.get(names[index]));
}

async function publishAtomically(outputDirectory, rendered) {
  const parent = dirname(outputDirectory);
  const staging = resolve(parent, `.schemas-${randomUUID()}`);
  const backup = resolve(parent, `.schemas-backup-${randomUUID()}`);
  await mkdir(parent, { recursive: true });
  await mkdir(staging);
  try {
    await Promise.all(
      [...rendered].map(([name, content]) =>
        writeFile(resolve(staging, name), content, { encoding: "utf8", flag: "wx" }),
      ),
    );
    if (await outputMatches(outputDirectory, rendered)) {
      await rm(staging, { recursive: true });
      return;
    }
    let backedUp = false;
    try {
      await rename(outputDirectory, backup);
      backedUp = true;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    try {
      await rename(staging, outputDirectory);
      if (backedUp) await rm(backup, { force: true, recursive: true });
    } catch (error) {
      if (backedUp) await rename(backup, outputDirectory);
      throw error;
    }
  } catch (error) {
    await rm(staging, { force: true, recursive: true });
    throw error;
  }
}

export async function generateSchemas(input) {
  if (!input || typeof input !== "object") throw new TypeError("schema generation input is required");
  const repositoryRoot = await realpath(input.repositoryRoot);
  if (typeof input.outputDirectory !== "string" || input.outputDirectory.length === 0) {
    throw new TypeError("schema output is outside repository scope");
  }
  const outputDirectory = resolve(repositoryRoot, input.outputDirectory);
  const scoped = relative(repositoryRoot, outputDirectory);
  if (scoped === "" || scoped === ".." || scoped.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new TypeError(`schema output is outside repository scope: ${input.outputDirectory}`);
  }

  validateEntries(CANONICAL_SCHEMA_ENTRIES);
  const rendered = new Map(CANONICAL_SCHEMA_ENTRIES.map(([name, schema]) => [name, render(schema)]));
  await publishAtomically(outputDirectory, rendered);
  return {
    ok: true,
    task: "T03",
    files: [...rendered.keys()].sort(),
    digests: Object.fromEntries([...rendered].map(([name, content]) => [name, digest(content)]).sort()),
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = await generateSchemas({ repositoryRoot, outputDirectory: "schemas" });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
