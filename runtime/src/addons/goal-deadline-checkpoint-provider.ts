export interface AddonGoalDeadlineCheckpointLease {
  chatJid: string;
  goalId: string;
  objective: string;
  planFingerprint: string;
  operationId: string;
  sourceSeq: number;
  operationGeneration: number;
  oldTurnId: string;
  checkpointId: string;
  expiresAt: string;
}

export interface AddonGoalDeadlineCheckpointResolution {
  action: "continue" | "complete" | "stop" | "suppress";
  goalId: string;
  objective: string;
  planFingerprint: string;
  visibleText: string;
  continuationText?: string;
}

export interface AddonGoalDeadlineCheckpointProvider {
  tryLatch(input: Omit<AddonGoalDeadlineCheckpointLease, "goalId" | "objective" | "planFingerprint" | "expiresAt"> & {
    deadlineAt: string;
  }): AddonGoalDeadlineCheckpointLease | null;
  revalidate(lease: AddonGoalDeadlineCheckpointLease): AddonGoalDeadlineCheckpointResolution;
  markScheduled(lease: AddonGoalDeadlineCheckpointLease, continuation: { generation: number }): void;
  release(lease: AddonGoalDeadlineCheckpointLease): void;
  resolveContinuation(input: {
    chatJid: string;
    goalId: string;
    checkpointId: string;
    generation: number;
  }): { status: "continue"; content: string } | { status: "suppress" };
}

let provider: AddonGoalDeadlineCheckpointProvider | null = null;

export function registerAddonGoalDeadlineCheckpointProvider(next: AddonGoalDeadlineCheckpointProvider): () => void {
  if (!next || typeof next.tryLatch !== "function" || typeof next.revalidate !== "function"
    || typeof next.markScheduled !== "function" || typeof next.release !== "function"
    || typeof next.resolveContinuation !== "function") return () => {};
  provider = next;
  return () => {
    if (provider === next) provider = null;
  };
}

export function getAddonGoalDeadlineCheckpointProvider(): AddonGoalDeadlineCheckpointProvider | null {
  return provider;
}

export function resetAddonGoalDeadlineCheckpointProviderForTests(): void {
  provider = null;
}
