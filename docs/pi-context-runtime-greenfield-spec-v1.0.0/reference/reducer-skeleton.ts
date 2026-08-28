export interface ObservationReducer<I, O> {
  readonly id: string;
  readonly revision: string;
  matches(input: I): boolean;
  reduce(input: I, signal: AbortSignal): Promise<O>;
}

export class ReducerRegistry<I, O> {
  constructor(private readonly reducers: readonly ObservationReducer<I, O>[], private readonly fallback: ObservationReducer<I, O>) {}
  async reduce(input: I, signal: AbortSignal): Promise<O> {
    const reducer = this.reducers.find((candidate) => candidate.matches(input)) ?? this.fallback;
    return reducer.reduce(input, signal);
  }
}
