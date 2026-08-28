const OWNER = Symbol.for("pi-context-runtime.owner.v1");

type OwnerSlot = { instanceId: string };

type GlobalWithOwner = typeof globalThis & { [OWNER]?: OwnerSlot };

export function claimPiContextOwner(instanceId: string): { release(): void } {
  const root = globalThis as GlobalWithOwner;
  if (root[OWNER]) {
    throw new Error(`PCR_OWNER_ALREADY_CLAIMED:${root[OWNER].instanceId}`);
  }
  root[OWNER] = { instanceId };
  return {
    release: () => {
      if (root[OWNER]?.instanceId === instanceId) {
        delete root[OWNER];
      }
    },
  };
}

export function resetOwnerForTest(): void {
  delete (globalThis as GlobalWithOwner)[OWNER];
}

export function currentOwnerId(): string | undefined {
  return (globalThis as GlobalWithOwner)[OWNER]?.instanceId;
}
