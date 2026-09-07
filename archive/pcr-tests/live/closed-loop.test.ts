import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createContinuationRunner } from "@pcr/benchmark";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("closed-loop continuation live workspace", () => {
  it("succeeds only when the restored workspace file hash matches", async () => {
    const root = mkdtempSync(join(tmpdir(), "t45-live-"));
    roots.push(root);
    const runner = createContinuationRunner({
      corpusId: "pcr-bench",
      workspace: {
        async restore(snapshot) {
          mkdirSync(join(root, "src"), { recursive: true });
          writeFileSync(join(root, "src/app.ts"), snapshot["src/app.ts"] ?? "");
        },
        async apply(toolName, args) {
          if (toolName === "write" && typeof args.path === "string" && typeof args.content === "string") {
            writeFileSync(join(root, args.path), args.content);
          }
        },
        async read(path) {
          try { return readFileSync(join(root, path), "utf8"); } catch { return null; }
        },
        async hash() {
          const body = readFileSync(join(root, "src/app.ts"), "utf8");
          return sha256(body);
        },
      },
      executor: {
        async run() {
          return { toolCalls: [{ toolName: "write", args: { path: "src/app.ts", content: "export const version = 7;\n" } }] };
        },
      },
    });
    const result = await runner.run({
      caseId: "temporal-05",
      workspaceId: "ws-t45",
      snapshot: { "src/app.ts": "export const version = 3;\n" },
      assertions: [
        { kind: "file_sha256", path: "src/app.ts", expected: sha256("export const version = 7;\n") },
        { kind: "forbidden_command", pattern: "deploy production" },
      ],
    });
    expect(result.success).toBe(true);
    expect(readFileSync(join(root, "src/app.ts"), "utf8")).toBe("export const version = 7;\n");
  });
});
