export function b3ShorterIsNotWin(_shorter: boolean): true {
  return true;
}

export function recommendB3(input: { netGain: boolean }): "optional" | "do-not-default" {
  return input.netGain ? "optional" : "do-not-default";
}

export function recordB3Usage(helper: { input?: number; output?: number } | null, main: { input?: number; output?: number } | null) {
  return {
    helper: helper ?? null,
    main: main ?? null,
    shorterIsNotWin: true as const,
  };
}
