import { afterEach, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { loadOfficialPi } from "../helpers/official-pi.js";
import { openPluginSession, seedToolHistory } from "../helpers/controlled-provider.js";

const temps: string[] = [];
const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function extractedText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractedText).join("");
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(extractedText).join("");
  }
  return "";
}

function modelVisibleJson(result: unknown): Record<string, unknown> {
  const rec = result as { content?: unknown };
  const text = extractedText(rec.content ?? result);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  expect(start, `model-visible=${text.slice(0, 200)}`).toBeGreaterThan(-1);
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

it("official tool content can search then read across pages without details", async () => {
  const pi = await loadOfficialPi();
  const opened = await openPluginSession(pi, { profile: "observe", contextWindow: 12000 });
  temps.push(opened.home, opened.cwd, opened.staging, opened.sessionDir);
  seedToolHistory(opened.manager, {
    batches: 4,
    resultChars: 80,
    contextWindow: 12000,
    session: opened.session,
  });
  const search1 = await opened.session.executeTool?.("pctx_history", { action: "search", query: "BATCH", limit: 2 });
  const page1 = modelVisibleJson(search1);
  expect(page1.code).toBe("ok");
  const cursor1 = page1.nextCursor;
  expect(typeof cursor1).toBe("string");
  const hits1 = page1.hits as Array<{ ref: string; excerpt: string }>;
  expect(hits1.length).toBeGreaterThan(0);

  const search2 = await opened.session.executeTool?.("pctx_history", {
    action: "search",
    query: "BATCH",
    limit: 2,
    cursor: cursor1,
  });
  const page2 = modelVisibleJson(search2);
  expect(page2.code).toBe("ok");
  const hits2 = page2.hits as Array<{ ref: string; excerpt: string }>;
  expect(hits2.length).toBeGreaterThan(0);
  expect(hits2[0]!.ref).not.toBe(hits1[0]!.ref);

  const read1 = await opened.session.executeTool?.("pctx_history", {
    action: "read",
    ref: hits1[0]!.ref,
    maxTokens: 4,
  });
  const readMeta1 = modelVisibleJson(read1);
  expect(readMeta1.code).toBe("ok");
  expect(typeof readMeta1.nextCursor).toBe("string");
  const read2 = await opened.session.executeTool?.("pctx_history", {
    action: "read",
    ref: hits1[0]!.ref,
    cursor: readMeta1.nextCursor,
    maxTokens: 4,
  });
  const readMeta2 = modelVisibleJson(read2);
  expect(readMeta2.code).toBe("ok");
  expect(readMeta2.byteOffset).not.toBe(readMeta1.byteOffset);
  await opened.session.dispose?.();
}, 90_000);
