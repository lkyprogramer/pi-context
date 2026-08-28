export class ScopeDeniedError extends Error {
  readonly code = "SCOPE_DENIED";
  constructor(handle: string) {
    super(`SCOPE_DENIED: ${handle}`);
  }
}
