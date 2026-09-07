import { createHash } from "node:crypto";

export interface RunManifest {
  host: string;
  piVersion: string;
  sourceRevision: string;
  configHash: string;
  model: string;
  pricingIdentity: string | null;
  createdAt: string;
  immutable: true;
}

export function freezeManifest(input: Omit<RunManifest, "immutable" | "createdAt">): RunManifest {
  const manifest: RunManifest = { ...input, createdAt: new Date().toISOString(), immutable: true };
  Object.freeze(manifest);
  return manifest;
}

export function manifestHash(m: RunManifest): string {
  return createHash("sha256").update(JSON.stringify(m)).digest("hex");
}
