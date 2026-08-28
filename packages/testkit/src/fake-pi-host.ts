export type FakePiHook = "context" | "tool_result" | "tool_call" | string;

export interface FakePiEvent {
  messages?: Array<{ role: string; content: unknown }>;
  content?: unknown;
}

export interface FakePiEmitResult {
  errors: Array<{ hook: string; message: string }>;
}

type Handler = (event: FakePiEvent) => unknown | Promise<unknown>;

export interface FakePiHost {
  on(hook: FakePiHook, handler: Handler): void;
  emit(hook: FakePiHook, event: FakePiEvent): Promise<FakePiEmitResult>;
}

export function createFakePiHost(): FakePiHost {
  const handlers = new Map<string, Handler[]>();
  return {
    on(hook, handler) {
      const list = handlers.get(hook) ?? [];
      list.push(handler);
      handlers.set(hook, list);
    },
    async emit(hook, event) {
      const errors: Array<{ hook: string; message: string }> = [];
      for (const handler of handlers.get(hook) ?? []) {
        try {
          await handler(event);
        } catch (error) {
          errors.push({ hook, message: error instanceof Error ? error.message : String(error) });
        }
      }
      return { errors };
    },
  };
}
