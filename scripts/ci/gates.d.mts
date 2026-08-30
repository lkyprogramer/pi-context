export interface CiGateResult {
  name: string;
  status: "passed" | "failed";
  logPath: string;
}

export interface DetailedCiGateResult extends CiGateResult {
  exitCode: number | null;
  aborted: boolean;
}

export interface RunCiGateInput {
  name: string;
  executable: string;
  arguments: readonly string[];
  workspaceRoot: string;
  logPath: string;
  signal?: AbortSignal;
  mirrorOutput?: boolean;
}

export function runCiGate(input: RunCiGateInput): Promise<DetailedCiGateResult>;
