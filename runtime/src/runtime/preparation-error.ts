/** Failed preparation has disposed its entire partial runtime. Unknown errors
 * and RuntimeStartupCleanupError provide no disposal certificate. Retry permits
 * another preparation only, never replay of an invocation. */
export class RuntimePreparationError extends Error {
  constructor(cause: unknown, readonly retryableStorage = false) {
    super(cause instanceof Error ? cause.message : "Native runtime preparation failed", { cause });
  }
}
