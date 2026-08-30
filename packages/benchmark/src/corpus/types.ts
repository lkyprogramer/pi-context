export interface CorpusManifest {
  benchmarkMajor: number;
  trainHash: string;
  devHash: string;
  lockedTestHash: string;
  clusters: Record<string, string[]>;
}

export interface CorpusCase {
  id: string;
  cluster: string;
  corpusId: string;
  body: string;
}

export interface CorpusStore {
  list(): Promise<readonly CorpusCase[]>;
  readManifest(): Promise<CorpusManifest | null>;
  writeManifest(manifest: CorpusManifest): Promise<void>;
}

export interface LockCorpusInput {
  benchmarkMajor: number;
  signal?: AbortSignal;
}

export interface CorpusGovernor {
  lock(input: LockCorpusInput): Promise<CorpusManifest>;
}

export interface CreateCorpusGovernorInput {
  corpusId: string;
  store: CorpusStore;
}

export interface CreateFileCorpusStoreInput {
  root: string;
  corpusId: string;
}
