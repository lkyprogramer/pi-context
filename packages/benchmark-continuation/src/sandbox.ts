export interface Sandbox {
  readonly workspaceHash: string;
  run(command: string): { stdout: string; forbidden: boolean };
}

export function createSandbox(workspaceHash: string, forbidden = /deploy/i): Sandbox {
  return {
    workspaceHash,
    run(command: string) {
      return { stdout: command.includes("test") ? "exit 0" : "ok", forbidden: forbidden.test(command) };
    },
  };
}
