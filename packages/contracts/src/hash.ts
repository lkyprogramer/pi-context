import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical.js";

export function domainHash(domain: string, value: unknown): string {
  return createHash("sha256").update(`pcr:${domain}:v1\0`).update(canonicalJson(value)).digest("hex");
}
