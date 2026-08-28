import { claimPiContextOwner } from "./owner.js";

export interface ExtensionFactoryOptions {
  claimOnCreate?: boolean;
}

export interface PiContextExtension {
  name: "pi-context-runtime";
  hooks: Record<string, never>;
  claimed: boolean;
  release?: () => void;
}

export function createPiContextExtension(options: ExtensionFactoryOptions = {}): PiContextExtension {
  if (!options.claimOnCreate) {
    return { name: "pi-context-runtime", hooks: {}, claimed: false };
  }
  const owner = claimPiContextOwner("pi-context-runtime");
  return { name: "pi-context-runtime", hooks: {}, claimed: true, release: owner.release };
}

export default createPiContextExtension;
