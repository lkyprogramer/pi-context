import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";
import type { RecoveryCaseResult } from "../../packages/benchmark/src/scoring/recovery.js";
import { createProductHarness, type ProductHarnessHost } from "./product-harness.js";

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

function observationText(pageText: string): string | null {
  try {
    const envelope = JSON.parse(pageText) as {
      format?: unknown;
      content?: Array<{ type?: unknown; text?: unknown }>;
    };
    if (envelope.format !== "pcr-observation-v1" || !Array.isArray(envelope.content)) return null;
    return envelope.content
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("");
  } catch {
    return null;
  }
}

async function toolTurn(harness: ProductHarnessHost, name: string, args: Record<string, unknown>): Promise<string> {
  await harness.runToolTurn(name, args);
  return harness.toolTexts().at(-1) ?? "";
}

export async function probeLiveArmRecovery(input: {
  sessionFile: string;
  cwd: string;
  seedText: string;
}): Promise<RecoveryCaseResult> {
  const needle = input.seedText.trim().slice(0, 48);
  if (needle.length === 0) {
    return { eligible: false, attempted: false, exactBytesMatch: null, wrongScopeDenied: null };
  }
  const primary = await createProductHarness({
    root: input.cwd,
    sessionFile: input.sessionFile,
    disposeRoot: false,
  });
  let outsider: ProductHarnessHost | undefined;
  try {
    await primary.prompt("Recover the original tool observation after compact.");
    const search = await toolTurn(primary, "context_search", { query: needle, limit: 8, timeoutMs: 250 });
    const body = parseJsonObject(search);
    const hits = Array.isArray(body?.hits) ? body.hits : [];
    const evidenceId = hits.flatMap((hit) => {
      if (!hit || typeof hit !== "object") return [];
      const id = (hit as { evidenceId?: unknown }).evidenceId;
      return typeof id === "string" && id.startsWith("ev_") ? [id] : [];
    })[0];
    if (!evidenceId) {
      return { eligible: true, attempted: true, exactBytesMatch: false, wrongScopeDenied: false };
    }
    const raw = await toolTurn(primary, "context_read", { evidenceId });
    const page = parseJsonObject(raw);
    const text = typeof page?.text === "string" ? page.text : "";
    const recovered = observationText(text);
    const exact = page?.verified === true && (recovered === input.seedText || text.includes(needle));
    outsider = await createProductHarness();
    const deniedRaw = await toolTurn(outsider, "context_read", { evidenceId });
    const deniedPage = parseJsonObject(deniedRaw);
    const denied = isScopeDenied(deniedRaw)
      || !deniedPage
      || (deniedPage.verified !== true && typeof deniedPage.text !== "string");
    return {
      eligible: true,
      attempted: true,
      exactBytesMatch: exact,
      wrongScopeDenied: denied,
    };
  } catch {
    return { eligible: true, attempted: true, exactBytesMatch: false, wrongScopeDenied: false };
  } finally {
    await outsider?.close();
    await primary.close();
    resetOwnerForTest();
  }
}
