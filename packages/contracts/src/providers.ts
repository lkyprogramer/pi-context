export interface Clock {
  now(): number;
}

export interface IdProvider {
  next(domain: string): string;
}

export function fixedClock(epochMs: number): Clock {
  return { now: () => epochMs };
}

export function sequenceIdProvider(seed = 0): IdProvider {
  let sequence = seed;
  return {
    next(domain: string): string {
      sequence += 1;
      return `${domain}:${String(sequence).padStart(8, "0")}`;
    },
  };
}
