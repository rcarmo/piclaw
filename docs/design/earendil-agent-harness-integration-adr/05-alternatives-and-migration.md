# Alternatives and migration

The evidence-based comparison, selected alternative, nine-phase reversible migration, shadow parity metrics, validation matrix and installed-service gates are in [`evidence/alternatives-and-migration.md`](evidence/alternatives-and-migration.md). The selected execution design is the authoritative Earendil Harness v3 [`harness.md`](https://github.com/earendil-works/pi/blob/5f7195c51eac43cdf329f813a7ef020d7bd74527/packages/agent/docs/harness.md). Released `0.84.1` remains historical baseline evidence, while the current Piclaw loop selects `0.84.4`. Harness-v3 production selection still waits for one coherent tagged implementation.

## Alternatives to assess

The completed ADR must compare at least these options:

1. keep Piclaw's current loop and add adapters around it;
2. refactor the current loop into a reducer and later adapt Earendil;
3. replace the loop with a Piclaw-designed reducer over effector ports;
4. adopt Earendil's harness directly and keep only Piclaw service-plane contracts/effectors;
5. implement the selected Earendil version's public contracts in tests, then run the same semantic suite against its real harness.

Options 1 and 2 appear incompatible with the no-existing-orchestration constraint but remain in the comparison to document why they are rejected.

## Migration quality bar

The final ADR must propose increments that preserve rollback and isolate ownership changes. Each increment needs:

- entry and exit contracts;
- old and new owner for each responsibility;
- state compatibility;
- shadow or parity evidence where possible;
- fault and restart tests;
- duplicate-delivery checks;
- an explicit rollback path;
- installed-service validation before deployment.

Archived post-`v2.13.2` changes should be reviewed as requirements, root-cause evidence and regression tests. They should not be cherry-picked wholesale into the harness integration.
