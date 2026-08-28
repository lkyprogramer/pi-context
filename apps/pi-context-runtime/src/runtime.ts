export interface SessionRuntime {
  sessionId: string;
  schedule(name: string, fn: () => void): void;
  shutdown(): void;
  activeHandles(): number;
}

export function createSessionRuntime(sessionId: string): SessionRuntime {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  return {
    sessionId,
    schedule(_name, fn) {
      const handle = setTimeout(fn, 0);
      timers.add(handle);
    },
    shutdown() {
      for (const handle of timers) {
        clearTimeout(handle);
      }
      timers.clear();
    },
    activeHandles() {
      return timers.size;
    },
  };
}
