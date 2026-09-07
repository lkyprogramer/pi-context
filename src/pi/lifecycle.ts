export class GenerationClock {
  value = 0;
  bump(reason: string): number {
    this.value += 1;
    this.lastReason = reason;
    return this.value;
  }
  lastReason = "init";
}

export function shouldBypassOnAmbiguity(mapped: number, outbound: number): boolean {
  return mapped === 0 && outbound > 0;
}
