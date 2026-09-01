import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  freezeAuditV2,
  verifyAuditV2Manifest,
} from "../../audit-v2/freeze.mjs";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("audit-v2 evidence manifest", () => {
  it("fails when any frozen evidence file is mutated", () => {
    const scratch = mkdtempSync(join(tmpdir(), "pcr-b00-"));
    roots.push(scratch);
    const evidenceDirectory = join(scratch, "evidence");
    const auditDirectory = join(scratch, "audit-v2");
    const frozen = freezeAuditV2({
      repositoryRoot: process.cwd(),
      evidenceDirectory,
      auditDirectory,
    });
    expect(frozen.baseline.auditedHead).toMatch(/^[0-9a-f]{40}$/);
    verifyAuditV2Manifest({
      evidenceDirectory: frozen.evidenceDirectory,
      auditDirectory,
      manifestPath: frozen.manifestPath,
      repositoryRoot: process.cwd(),
    });

    const target = join(evidenceDirectory, "source-inventory.json");
    writeFileSync(target, `${JSON.stringify({ tampered: true })}\n`);
    try {
      verifyAuditV2Manifest({
        evidenceDirectory,
        auditDirectory,
        manifestPath: join(auditDirectory, "MANIFEST.sha256"),
      });
      throw new Error("expected mutated evidence to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "PCR_AUDIT_V2_MANIFEST_MISMATCH" });
    }
  });

  it("stops at the abort boundary before hashing", () => {
    const scratch = mkdtempSync(join(tmpdir(), "pcr-b00-abort-"));
    roots.push(scratch);
    mkdirSync(join(scratch, "evidence"), { recursive: true });
    mkdirSync(join(scratch, "audit-v2"), { recursive: true });
    writeFileSync(join(scratch, "evidence", "a.json"), "{}\n");
    writeFileSync(join(scratch, "MANIFEST.sha256"), "00  a.json\n");
    const signal = AbortSignal.abort(new DOMException("stopped", "AbortError"));
    expect(() =>
      verifyAuditV2Manifest({
        evidenceDirectory: join(scratch, "evidence"),
        auditDirectory: join(scratch, "audit-v2"),
        manifestPath: join(scratch, "MANIFEST.sha256"),
        signal,
      }),
    ).toThrow(/stopped|AbortError/);
  });
});
