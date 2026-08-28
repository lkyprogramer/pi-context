import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface HostEvent {
  readonly type: "session_start" | "session_before_compact" | "session_compact" | "session_abort";
  readonly detail?: unknown;
}

export interface PiHostSession {
  compact(summary: string): Promise<{ entryId: string; summary: string }>;
  events(): readonly HostEvent[];
}

export interface PiHost {
  readonly home: string;
  readonly loadedOwners: readonly string[];
  createSession(): Promise<PiHostSession>;
}

export async function createPiHost(input: { home?: string; owners?: readonly string[] }): Promise<PiHost> {
  const owners = input.owners ?? ["pi-native"];
  if (owners.some((owner) => owner !== "pi-native")) {
    throw new Error("capability mismatch: only pi-native host owner is allowed for A0");
  }
  const home = input.home ?? mkdtempSync(join(tmpdir(), "pcr-pi-home-"));
  const events: HostEvent[] = [{ type: "session_start", detail: { home } }];
  return {
    home,
    loadedOwners: owners,
    async createSession() {
      return {
        async compact(summary: string) {
          events.push({ type: "session_before_compact", detail: { owner: "pi-native" } });
          const entry = { entryId: `compact-${events.length}`, summary };
          events.push({ type: "session_compact", detail: entry });
          return entry;
        },
        events() {
          return events;
        },
      };
    },
  };
}
