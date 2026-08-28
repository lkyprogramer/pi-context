const writers = new Map<string, true>();

export class StorageWorker {
  #queue: Promise<unknown> = Promise.resolve();

  enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(work, work);
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export function claimWriter(path: string): void {
  if (writers.has(path)) {
    throw Object.assign(new Error("PCR_STORE_WRITER_LOCKED"), { code: "PCR_STORE_WRITER_LOCKED" });
  }
  writers.set(path, true);
}

export function releaseWriter(path: string): void {
  writers.delete(path);
}
