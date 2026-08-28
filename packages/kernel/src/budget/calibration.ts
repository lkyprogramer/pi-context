export interface CalibrationAnchor {
  modelKey: string;
  viewId?: string;
  outputHash?: string;
}

export interface CalibrationSample {
  heuristicTokens: number;
  providerInputTokens: number;
}

export class CalibrationBucket {
  private density = 1;
  private frozen = false;
  private anchor: CalibrationAnchor;
  constructor(anchor: CalibrationAnchor) {
    this.anchor = anchor;
  }

  modelKey(): string {
    return this.anchor.modelKey;
  }

  observe(sample: CalibrationSample, nextAnchor: CalibrationAnchor): number {
    if (nextAnchor.modelKey !== this.anchor.modelKey) {
      return this.reset(nextAnchor);
    }
    if (
      (this.anchor.viewId && nextAnchor.viewId && this.anchor.viewId !== nextAnchor.viewId) ||
      (this.anchor.outputHash && nextAnchor.outputHash && this.anchor.outputHash !== nextAnchor.outputHash)
    ) {
      this.frozen = true;
      return this.density;
    }
    if (this.frozen || sample.heuristicTokens <= 0) return this.density;
    const raw = sample.providerInputTokens / sample.heuristicTokens;
    this.density = Math.max(0, raw);
    return this.density;
  }

  apply(heuristicTokens: number): number {
    const calibrated = heuristicTokens * this.density;
    if (calibrated < 0) return 0;
    return calibrated;
  }

  reset(nextAnchor: CalibrationAnchor): number {
    this.density = 1;
    this.frozen = false;
    this.anchor = nextAnchor;
    return this.density;
  }
}

export function safeUsageDelta(heuristicTokens: number, providerInputTokens: number): number {
  const delta = providerInputTokens - heuristicTokens;
  return delta < 0 ? 0 : delta;
}
