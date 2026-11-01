/** A replacement preparation failed with transient storage contention and its
 * entire partial runtime was disposed. Never use this for uncertain cleanup or
 * for retrying an invocation against an existing backend. */
export class RuntimeStorageReopenError extends Error {
  constructor(cause: unknown) {
    super("Native storage reopen temporarily unavailable", { cause });
  }
}
