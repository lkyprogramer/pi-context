import { domainHash } from "../../../contracts/src/index.js";
import type { ContextHead, GenerationManifest } from "../../../storage/src/protocol.js";

export function fencingKey(input: {
  candidateKey: string;
  modelKey: string;
  configFingerprint: string;
  reducerRevisionSet: string;
  schemaVersion: string;
}): string {
  return domainHash("generation-fence", input);
}

export function deriveNextHead(head: ContextHead, manifest: GenerationManifest): ContextHead {
  return {
    hash: domainHash("context-head", {
      prev: head.hash,
      generationId: manifest.generationId,
      fencingKey: manifest.fencingKey,
    }),
    generationId: manifest.generationId,
    fencingKey: manifest.fencingKey,
  };
}

export type { ContextHead, GenerationManifest };
