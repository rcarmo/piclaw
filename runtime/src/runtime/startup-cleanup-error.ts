/** Cleanup could not certify disposal; main must retain its strict owner.
 * Kept dependency-free so backend error handling cannot initialize runtime services.
 */
export class RuntimeStartupCleanupError extends AggregateError {}
