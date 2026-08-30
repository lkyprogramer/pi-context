export interface AuditBaseline {
  commit: string;
  tree: string;
  sourceDigests: Record<string, string>;
}

export interface FreezeAuditBaselineInput {
  repositoryRoot: string;
  sourceFiles: readonly string[];
  findingsFile: string;
  outputDirectory: string;
}

export interface FreezeAuditBaselineResult {
  ok: true;
  task: "T00";
  baseline: AuditBaseline;
  artifacts: {
    manifest: string;
    findingsSnapshot: string;
  };
}

export function freezeAuditBaseline(input: FreezeAuditBaselineInput): Promise<FreezeAuditBaselineResult>;
