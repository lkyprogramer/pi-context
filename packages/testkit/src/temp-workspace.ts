import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createTempWorkspace(prefix = "pcr-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeTempWorkspace(root: string): void {
  rmSync(root, { force: true, recursive: true });
}
