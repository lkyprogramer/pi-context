import { resolve } from "node:path";

import type { RecoveryCaseResult } from "../../packages/benchmark/src/scoring/recovery.js";
import { createProductHarness, type ProductHarnessHost } from "./product-harness.js";

export type ProductRecoveryCaseId =
  | "protocol-text"
  | "protocol-utf8"
  | "protocol-image"
  | "protocol-append"
  | "protocol-restart-model-fence";

export interface NamedRecoveryCase extends RecoveryCaseResult {
  id: ProductRecoveryCaseId;
}

const TEXT_PAYLOAD = "exact-bytes-text-7f3c2e payload";
const UTF8_PAYLOAD = "文件=学员成绩-utf8-9a1b0d.xlsx";
const IMAGE_MARKER = "image-marker-7f3c2e";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function failed(id: NamedRecoveryCase["id"]): NamedRecoveryCase {
  return {
    id,
    eligible: true,
    attempted: true,
    exactBytesMatch: false,
    wrongScopeDenied: false,
  };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isScopeDenied(text: string): boolean {
  return /PCR_RETRIEVAL_SCOPE_DENIED|PCR_EVIDENCE_SCOPE_MISMATCH|PCR_EVIDENCE_NOT_FOUND/u.test(text);
}

async function toolTurn(harness: ProductHarnessHost, name: string, args: Record<string, unknown>): Promise<string> {
  await harness.runToolTurn(name, args);
  return harness.toolTexts().at(-1) ?? "";
}

async function searchHits(harness: ProductHarnessHost, query: string): Promise<string[]> {
  const text = await toolTurn(harness, "context_search", { query, limit: 8, timeoutMs: 250 });
  const body = parseJsonObject(text);
  const hits = Array.isArray(body?.hits) ? body.hits : [];
  return hits.flatMap((hit) => {
    if (!hit || typeof hit !== "object") return [];
    const evidenceId = (hit as { evidenceId?: unknown }).evidenceId;
    return typeof evidenceId === "string" && evidenceId.startsWith("ev_") ? [evidenceId] : [];
  });
}

async function readPage(harness: ProductHarnessHost, evidenceId: string): Promise<{
  text: string;
  sha256: string;
  verified: boolean;
  raw: string;
}> {
  const raw = await toolTurn(harness, "context_read", { evidenceId });
  const body = parseJsonObject(raw);
  return {
    raw,
    text: typeof body?.text === "string" ? body.text : "",
    sha256: typeof body?.sha256 === "string" ? body.sha256 : "",
    verified: body?.verified === true,
  };
}

function envelopeContent(pageText: string): Array<{ type?: unknown; text?: unknown; data?: unknown }> {
  try {
    const envelope = JSON.parse(pageText) as {
      format?: unknown;
      content?: Array<{ type?: unknown; text?: unknown; data?: unknown }>;
    };
    if (envelope.format !== "pcr-observation-v1" || !Array.isArray(envelope.content)) return [];
    return envelope.content;
  } catch {
    return [];
  }
}

function observationText(pageText: string): string | null {
  const texts = envelopeContent(pageText)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string);
  return texts.length > 0 ? texts.join("") : null;
}

function exactMatch(page: { text: string; sha256: string; verified: boolean }, original: string): boolean {
  if (!page.verified) return false;
  const recovered = observationText(page.text);
  if (recovered === original) return true;
  if (page.text === original) return true;
  return envelopeContent(page.text).some((block) => block.type === "image" && block.data === original);
}

async function denyRead(harness: ProductHarnessHost, evidenceId: string): Promise<boolean> {
  const raw = await toolTurn(harness, "context_read", { evidenceId });
  if (isScopeDenied(raw)) return true;
  const page = parseJsonObject(raw);
  if (!page) return true;
  return page.verified !== true && typeof page.text !== "string";
}

async function withOutsiderDeny(
  id: NamedRecoveryCase["id"],
  work: (primary: ProductHarnessHost) => Promise<{ evidenceId: string; original: string } | NamedRecoveryCase>,
): Promise<NamedRecoveryCase> {
  const primary = await createProductHarness({ disposeRoot: false });
  let outsider: ProductHarnessHost | undefined;
  try {
    const prepared = await work(primary);
    if ("id" in prepared) return prepared;
    const page = await readPage(primary, prepared.evidenceId);
    outsider = await createProductHarness();
    const denied = await denyRead(outsider, prepared.evidenceId);
    return {
      id,
      eligible: true,
      attempted: true,
      exactBytesMatch: exactMatch(page, prepared.original),
      wrongScopeDenied: denied,
    };
  } catch {
    return failed(id);
  } finally {
    await outsider?.close();
    await primary.close();
  }
}

async function runTextCase(): Promise<NamedRecoveryCase> {
  return withOutsiderDeny("protocol-text", async (primary) => {
    primary.scriptToolResult("log_note", { content: [{ type: "text", text: TEXT_PAYLOAD }] });
    await primary.runToolTurn("log_note", { text: TEXT_PAYLOAD });
    await primary.prompt("Keep the original tool output readable.");
    const evidenceId = (await searchHits(primary, TEXT_PAYLOAD.slice(0, 24)))[0];
    if (!evidenceId) return failed("protocol-text");
    return { evidenceId, original: TEXT_PAYLOAD };
  });
}

async function runUtf8Case(): Promise<NamedRecoveryCase> {
  return withOutsiderDeny("protocol-utf8", async (primary) => {
    primary.scriptToolResult("utf8_note", { content: [{ type: "text", text: UTF8_PAYLOAD }] });
    await primary.runToolTurn("utf8_note", { text: UTF8_PAYLOAD });
    await primary.prompt("Keep the original UTF-8 tool output readable.");
    const evidenceId = (await searchHits(primary, "学员成绩-utf8"))[0];
    if (!evidenceId) return failed("protocol-utf8");
    return { evidenceId, original: UTF8_PAYLOAD };
  });
}

async function runImageCase(): Promise<NamedRecoveryCase> {
  return withOutsiderDeny("protocol-image", async (primary) => {
    primary.scriptToolResult("shot", {
      content: [
        { type: "text", text: IMAGE_MARKER },
        { type: "image", mimeType: "image/png", data: PNG },
      ],
    });
    await primary.runToolTurn("shot", { path: "shot.png" });
    await primary.prompt("Keep the original image observation readable.");
    const evidenceId = (await searchHits(primary, IMAGE_MARKER))[0];
    if (!evidenceId) return failed("protocol-image");
    return { evidenceId, original: PNG };
  });
}

async function runAppendCase(): Promise<NamedRecoveryCase> {
  return withOutsiderDeny("protocol-append", async (primary) => {
    primary.scriptToolResult("log_note", { content: [{ type: "text", text: TEXT_PAYLOAD }] });
    await primary.runToolTurn("log_note", { text: TEXT_PAYLOAD });
    await primary.prompt("Append another user turn after the originals.");
    const evidenceId = (await searchHits(primary, TEXT_PAYLOAD.slice(0, 24)))[0];
    if (!evidenceId) return failed("protocol-append");
    return { evidenceId, original: TEXT_PAYLOAD };
  });
}

async function runRestartModelFenceCase(): Promise<NamedRecoveryCase> {
  return withOutsiderDeny("protocol-restart-model-fence", async (primary) => {
    primary.scriptToolResult("log_note", { content: [{ type: "text", text: TEXT_PAYLOAD }] });
    await primary.runToolTurn("log_note", { text: TEXT_PAYLOAD });
    await primary.restart();
    primary.manager.appendModelChange("controlled", "context-test");
    await primary.prompt("Continue after the model fence.");
    const evidenceId = (await searchHits(primary, TEXT_PAYLOAD.slice(0, 24)))[0];
    if (!evidenceId) return failed("protocol-restart-model-fence");
    return { evidenceId, original: TEXT_PAYLOAD };
  });
}

export async function runProductionRecoveryFixtures(): Promise<NamedRecoveryCase[]> {
  return [
    await runTextCase(),
    await runUtf8Case(),
    await runImageCase(),
    await runAppendCase(),
    await runRestartModelFenceCase(),
  ];
}

const invoked = typeof process.argv[1] === "string"
  && resolve(process.argv[1]).includes("production-recovery-fixtures");
if (invoked) {
  void runProductionRecoveryFixtures().then((rows) => {
    process.stdout.write(`${JSON.stringify({ rows })}\n`);
  }, (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
