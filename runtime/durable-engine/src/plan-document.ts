import { defineDocFamily } from '@earendil-works/pi-durable';

import type { SessionPlan } from '../../src/plan/markdown.js';
export type PlanDocument = SessionPlan;

/** One SDK-owned document per exact chat/branch JID, independent of conversation
 * reset or creation. Legacy KV is only an adoption source, never a second writer.
 * The caller binds the family key and seed to its authorised native/HTTP scope. */
export const PlanDoc = defineDocFamily<PlanDocument, PlanDocument>({
  kind: 'app.plan', version: 1, scope: 'session', family: true,
  initial: seed => ({ ...seed }),
  checkpointWhen: () => true,
});
