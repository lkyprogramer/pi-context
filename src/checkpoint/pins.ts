import type { NativeEntry, SourceLocator } from "../contracts.js";
import { sha256Hex, utf8Slice } from "../contracts.js";

export interface Pin {
  pinId: string;
  source: SourceLocator;
  startByte: number;
  endByteExclusive: number;
  quoteHash: string;
  createdByEntryId: string;
  state: "active" | "released";
}

export const PIN_TYPE = "pctx.pin.v5";

export function pinId(source: SourceLocator, startByte: number, endByteExclusive: number): string {
  return sha256Hex(`${source.entryId}:${source.field.blockIndex}:${startByte}:${endByteExclusive}`).slice(0, 16);
}

export function restorePins(entries: NativeEntry[], visible: ReadonlySet<string>): Pin[] {
  const byId = new Map<string, Pin>();
  for (const entry of entries) {
    if (!visible.has(entry.id)) continue;
    if (entry.customType !== PIN_TYPE || !entry.data || typeof entry.data !== "object") continue;
    const pin = entry.data as Pin;
    if (pin.state === "released") {
      byId.delete(pin.pinId);
    } else {
      byId.set(pin.pinId, pin);
    }
  }
  return [...byId.values()];
}

export function quoteHash(text: string, startByte: number, endByteExclusive: number): string {
  return sha256Hex(utf8Slice(text, startByte, endByteExclusive));
}
