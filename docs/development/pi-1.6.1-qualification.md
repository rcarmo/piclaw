# Earendil 1.6.1 qualification

The Root and private durable engine use separate frozen 1.6.1 package graphs. The upstream [v1.6.1 tag](https://github.com/earendil-works/pi/releases/tag/v1.6.1) resolves to `ef4a1cfcca62b77ad3558337ff3e1c7f6beeadfe`. The direct Root OpenAI pin stays at 7.52.0; the private SDK's existing transitive OpenAI remains at 7.59.0. No SDK files are patched.

## Reproduce the package and API evidence

In a provisioned disposable checkout, with both frozen graphs installed:

```sh
bun scripts/qualification/pi160/generate-current-contracts.ts --allow-network --release=1.6.1
bun run test:local -- bun --no-env-file scripts/qualification/pi160/finish-auth-160.ts --release=1.6.1
bun run test:local -- bun --no-env-file scripts/qualification/pi160/measure-cli-remaining.ts --release=1.6.1
bun qualification/native/src/provenance.ts --record
```

The archive acquisition uses public registry data only. It checks package bytes, digests and decoded attestation subjects and tag identity; it does not independently verify attestation signatures. The authentication fixtures use synthetic profiles, intercepted requests and their existing loopback-only process guards. The 1.6.0 evidence files remain as historical records. Run `make ci-full` with the exact native add-on fixtures before publishing a candidate.

## Smith turn-start incident

The SDK upgrade is independent of SMITH-TURN-20261125-0753. In a disposable comparison with the same Core input path and test fixture, holding a real foreground `fsync` or `pread64` for 2.5 seconds still caused Classic and status timeouts on 1.6.1. The 600-GET maxima were 3.03 s and 3.90 s, above the 1.5 s gate. Full WAL durability and one generation per admitted input were preserved. Ambient I/O pressure varied; the single-run extrema do not establish a performance improvement. The upgrade does not move the Bun SQLite transaction off the HTTP event loop.
