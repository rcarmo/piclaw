export type CompatibilityStatus = "pass" | "fail" | "unsupported";
export type RuntimeSelection = "historical" | "installed";
export type HarnessSelection = "baseline_evidence" | "rejected_evidence_only";
export type PackageInstallation = "direct" | "transitive" | "not_installed";

export interface EarendilPackageEvidence {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly shasum: string;
  readonly gitHead: string;
  readonly engine: string;
  readonly installation: PackageInstallation;
  readonly exports: readonly string[];
  readonly internalDependencies: readonly Readonly<{ name: string; range: string }>[];
}

export interface EarendilReleaseFingerprint {
  readonly package: string;
  readonly subpath: string;
  readonly kind: "runtime" | "declaration";
  readonly sha256: string;
}

export interface EarendilReleaseEvidence {
  readonly role: "historical_harness_baseline" | "current_runtime_harness_candidate";
  readonly tag: "v0.84.1" | "v0.84.4";
  readonly commit: string;
  readonly runtimeSelection: RuntimeSelection;
  readonly harnessSelection: HarnessSelection;
  readonly packages: readonly EarendilPackageEvidence[];
  readonly fingerprints: readonly EarendilReleaseFingerprint[];
  readonly conformance: Readonly<{
    caseCount: number;
    catalogueSha256: string;
    auditedResultSha256: string;
    memory: "pass" | "historical_pass";
    jsonl: "pass" | "historical_pass";
    sqlite: "unsupported";
    sqliteReason: "package_not_installed" | "bun_node_sqlite_unavailable";
  }>;
}

export interface EarendilBoundaryEvidence {
  readonly id: `EB-0${1 | 2 | 3 | 4 | 5}`;
  readonly name: string;
  readonly compileStatus: CompatibilityStatus;
  readonly runtimeStatus: CompatibilityStatus;
  readonly evidence: string;
}

export interface EarendilCapabilityEvidence {
  readonly id: `HC-0${string}`;
  readonly name: string;
  readonly requirement: string;
  readonly status: "unsupported";
  readonly operations: readonly string[];
  readonly missingExports: readonly string[];
  readonly reason: "harness_not_implemented" | "restore_not_implemented" | "missing_v3_surface" | "partial_scaffold_is_not_capability";
}

export interface EarendilHarnessCompatibilityManifest {
  readonly schemaVersion: 2;
  readonly authority: Readonly<{
    currentRuntimeVersion: "0.84.4";
    harnessBaselineVersion: "0.84.1";
    harnessCandidateVersion: "0.84.4";
    harnessCandidateSelection: "rejected_evidence_only";
    unsupportedCountsAsPass: false;
    harnessActivation: "latent_only";
    designCommit: string;
    draftEvidenceCommit: string;
  }>;
  readonly releases: readonly EarendilReleaseEvidence[];
  readonly boundaries: readonly EarendilBoundaryEvidence[];
  readonly capabilities: readonly EarendilCapabilityEvidence[];
  readonly promotionCriteria: readonly Readonly<{ id: `PG-0${number}`; requirement: string }>[];
}

export type EarendilManifestIssueCode =
  | "invalid_container"
  | "accessor_rejected"
  | "symbol_rejected"
  | "cycle_rejected"
  | "invalid_value"
  | "excessive_input"
  | "closed_shape_mismatch"
  | "manifest_drift";

export interface EarendilManifestIssue {
  readonly code: EarendilManifestIssueCode;
  readonly path: string;
  readonly message: string;
}

export type EarendilManifestNormalizationResult =
  | Readonly<{ ok: true; value: EarendilHarnessCompatibilityManifest; issues: readonly EarendilManifestIssue[] }>
  | Readonly<{ ok: false; value: null; issues: readonly EarendilManifestIssue[] }>;

const PACKAGE_NAMES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-client",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-protocol",
  "@earendil-works/pi-server",
  "@earendil-works/pi-session-backend-sqlite-node",
  "@earendil-works/pi-telemetry",
  "@earendil-works/pi-tui",
] as const;

const EXPORTS = {
  "@earendil-works/pi-agent-core": [".", "./node", "./package.json", "./session/testing"],
  "@earendil-works/pi-ai": [".", "./api/*", "./bedrock-provider", "./bun-oauth", "./compat", "./oauth", "./providers/*"],
  "@earendil-works/pi-client": [".", "./package.json", "./unix"],
  "@earendil-works/pi-coding-agent": [".", "./client", "./rpc-entry"],
  "@earendil-works/pi-protocol": ["."],
  "@earendil-works/pi-server": [".", "./testing", "./unix"],
  "@earendil-works/pi-session-backend-sqlite-node": ["."],
  "@earendil-works/pi-telemetry": [".", "./testing"],
  "@earendil-works/pi-tui": [],
} as const;

const INTERNAL_DEPENDENCIES = {
  "@earendil-works/pi-agent-core": ["@earendil-works/pi-ai", "@earendil-works/pi-telemetry"],
  "@earendil-works/pi-ai": ["@earendil-works/pi-telemetry"],
  "@earendil-works/pi-client": ["@earendil-works/pi-protocol"],
  "@earendil-works/pi-coding-agent": ["@earendil-works/pi-agent-core", "@earendil-works/pi-ai", "@earendil-works/pi-client", "@earendil-works/pi-protocol", "@earendil-works/pi-tui"],
  "@earendil-works/pi-protocol": [],
  "@earendil-works/pi-server": ["@earendil-works/pi-ai", "@earendil-works/pi-protocol"],
  "@earendil-works/pi-session-backend-sqlite-node": ["@earendil-works/pi-agent-core", "@earendil-works/pi-ai"],
  "@earendil-works/pi-telemetry": [],
  "@earendil-works/pi-tui": [],
} as const;

const PUBLICATION_COORDINATES = {
  "0.84.1": [
    ["sha512-evyzXYWCLQGmcaBYHlmSku02r8qoN4SGI60GZABo6iV+H+nqX+P9ud8fEZ4GmRq9mUSREvvfX+w9dA9ThF9C6w==", "a611675f289cba8c1404f6a4e78d26c0bb9625c7"],
    ["sha512-wMsAdJMxuNri08vLqTyYVI201DQQezGhPSTkzYsHdw5dYX3rCNwEmSvpaAwhi7ELKI/2tE/CEgSWg/6iRxSgdQ==", "e3e6318392a9f6df6fcc9040dcfafa5e5fb779f4"],
    ["sha512-/V5hGHE4Zq+jG0GtwIB9PyBUOGd6gBLZ7lkQYFKchKnxYHeH3rmWC5xw4kpnZKKBuBuFTdLVbU9vEjlAGMMb2A==", "797fb7d37191a8db82a2f81287074d6428569f69"],
    ["sha512-ncAqFrG+iybuPGOhMiZoEHkEzTpJgz3guYD32pD+M7ucc0WeHmauP6wa7qwP8V/KWvsZDVNa5XGsdZ7fkC7w7A==", "e098cada629fdeeb9df6e77c6d480d43e1b2c553"],
    ["sha512-Ox1pciyeSPGEEUcxvR0/dJcrY7C6hrEGA8y71rOsvSIUlXN1Cbp/be/eoL71OGDBk5O97TeQPfWN6Ju/2Ehjww==", "631fc198bc526af247db7fdee2fc2ce13660760a"],
    ["sha512-MTTtt7LII7bdgRkG+xuWr4NoUUywDqFXXFaN/bYqkiR4Q4aIJ3437JvsPhWg6ytB+vQjzHSGWskVpthLmTpguw==", "a4f67bdb0143b8ba3ef50b7f2af09d5a4d67a956"],
    ["sha512-yUjfCSOU0JPXOZnIRCU4ueouKqbtFRAeDJWOBk7i6GRA0d8Rqp1/9ARGNLjeB1a7L11V590kfq9tghOj5OQQJQ==", "7b1e68dc64ab210bba44924c67069db17b1a548b"],
    ["sha512-180/xGJtsq7IoR3p9EKWjRd0e9M4DkxInhlo9xyD7prDC7Qrhqq+nhvwrW0lFjPfXcEI2FSHmGCSyvSJE9GsaQ==", "c82960238c0cee896c2f7caee4c18bbf932f58c3"],
    ["sha512-udeXFbgEhJ6JiB0uguwNVNkDy2FENfmtQwPcY+/iJ8GWeq18wkal1tKqa5YyeH0IqtX1vG0cGh8zfSYzyzVuLA==", "e9f05e103a9f268d0e4911959a4fb2095b0e3889"],
  ],
  "0.84.4": [
    ["sha512-HyUnjaOXj6oN/6SNcr8A1J/ElRQA50FtIE0XUTSKAQVqmdlb9qdojOyUQwF/jULE5+yOEtGuVgi/N1RnBiNG+g==", "451e9e76b6c7fecd2a49ed5bf905f8dd6c7ce876"],
    ["sha512-AClAZxf5+c4RRu44NJPS6wyQy+Nmq+Mzyyrdvm4ZVMNuixelO02RZX4G4Aq1F145Yzp43wnM5S+hLlSI7ypfVw==", "348f1be5c2a0f4d17cc167fe1e5a7cabb191d079"],
    ["sha512-q398WY/3ZQHTizk7IKxApzqFV0xt4yM9LkSkwyqeLK5Bj5RwRjOWxESt26z4LgNp4O+8hqhqFPf/8fj4H5rE4A==", "88523ba121aea1f57bae5d67656f09af7c6fcf02"],
    ["sha512-jmOlrqUmvhh/siNWFRXjYLJzhKFIHNsAQaysRwzQPQFnPAaV/vhqHsLH/MBsIISA1Rjj7WTUFR3nJrpXoLx39w==", "3a2f04bfc5e463b4cfa36b174a586d11a0bdf9ad"],
    ["sha512-acyE9ozxkMiWiz/xyWpU0O9vwnYv0hyG889Vniv6Sg9c9zfsX+8MePnDNphBacY2Fvm1rxdsGmiVDSZl9yuDFA==", "aee0630eb3ce6844d3f68323a4a1fffc988fb0c0"],
    ["sha512-VchGLu8oMF8TjxAuPwQVdcBUSMvsdhJH5+WgKOWgeSxfgsjRJsoTQKqrambPojNuB+1MB/uWgZehq2R1sQQCUA==", "bf1e5c43310671e21d4b06ace0db3da6d91501d9"],
    ["sha512-SIYZmYm8OBVTjB4rKXHTMuE/cesFr5mYo4cxsuhds6uHc6j092k3R66Uiw53fT305TkL89SQmS8SG57CPwVYug==", "06b2eb9c435e8a61a8df626e7f65088cca9e0b3c"],
    ["sha512-8e2CuxM+ht+hedQXTZmi5JVl6/xDK9RpSDL2+MbITevKYQhMZ/z6lJOTFgox3HQyGxO8mOZEtYGVeQNaD4OzqA==", "0eefd361fab1db773496384c87bfd91be2772790"],
    ["sha512-nPUnwDkLtupPXnZQYrCwPFcuTydCDqTY6ZbFqhsL4S4kVq0AT418kPa/6uXwtaCD+MjBNBltb7ScTYX65yeE1w==", "1b5bee5f22ba90539beaddac4e4ee7ad81c8a279"],
  ],
} as const;

function packageRows(version: "0.84.1" | "0.84.4", gitHead: string): EarendilPackageEvidence[] {
  return PACKAGE_NAMES.map((name, index) => ({
    name,
    version,
    integrity: PUBLICATION_COORDINATES[version][index][0],
    shasum: PUBLICATION_COORDINATES[version][index][1],
    gitHead,
    engine: ">=22.19.0",
    installation: [0, 1, 3].includes(index)
      ? "direct"
      : [2, 4, 7, 8].includes(index)
        ? "transitive"
        : "not_installed",
    exports: [...EXPORTS[name]],
    internalDependencies: INTERNAL_DEPENDENCIES[name].map((dependency) => ({ name: dependency, range: `^${version}` })),
  }));
}

const BASELINE_FINGERPRINTS: EarendilReleaseFingerprint[] = [
  { package: PACKAGE_NAMES[0], subpath: ".", kind: "runtime", sha256: "b981a7810efdb229f2878efddf9c6e7cdb5aa20cdbf6475999aa19a04c429f60" },
  { package: PACKAGE_NAMES[0], subpath: ".", kind: "declaration", sha256: "f367678a181c02df9e779c243f452defb8b98b3b0136442471ce9b2d2b548354" },
  { package: PACKAGE_NAMES[0], subpath: "./session/testing", kind: "runtime", sha256: "e21cd63169a0e410f0671579bffdeee345a711a56ee78c12d3567bc7e63a37eb" },
  { package: PACKAGE_NAMES[0], subpath: "./session/testing", kind: "declaration", sha256: "2b6527b390774a8a82fb17dd93022caccd41f3d5b5b383dd47ab416f65c2332f" },
  { package: PACKAGE_NAMES[0], subpath: "audit:harness-scaffold", kind: "runtime", sha256: "21fdb3355adafd53c26337617a73918ba49e9832c42cde8b71c469abeecb5916" },
  { package: PACKAGE_NAMES[0], subpath: "audit:harness-scaffold", kind: "declaration", sha256: "3ceafcd72816bc8312f3f851625c082ae0b9099821fb3329e6ff9df165033472" },
  { package: PACKAGE_NAMES[1], subpath: ".", kind: "runtime", sha256: "2317a3ec8d3b0474e45d6c5cca04c71d3795c21bf83c08008c5a0869f9f33d95" },
  { package: PACKAGE_NAMES[1], subpath: ".", kind: "declaration", sha256: "9f3280dbef8435619289ea791e407fc3c2ca57748ab244d45ceb8bfdb7ea3a0e" },
  { package: PACKAGE_NAMES[3], subpath: ".", kind: "runtime", sha256: "de74c5324f2b38317eb3f9ae36ef47b41e130a4501637a0e5fce555a3e1c065b" },
  { package: PACKAGE_NAMES[3], subpath: ".", kind: "declaration", sha256: "d2d1d6fde81c8a587d57ba01774b46738923bcc42dcf1bffd4c323daf2542918" },
];

const CANDIDATE_FINGERPRINTS: EarendilReleaseFingerprint[] = [
  { package: PACKAGE_NAMES[0], subpath: ".", kind: "runtime", sha256: "aeecb12a48528008887b2391fe93ef28c18ee6aa16bf81ec9d8eff57fb0a3647" },
  { package: PACKAGE_NAMES[0], subpath: ".", kind: "declaration", sha256: "c9199d555744fcb8bc7f9166418b5905e4b1d84bd7ab56b468949a1ca97d7240" },
  { package: PACKAGE_NAMES[0], subpath: "./session/testing", kind: "runtime", sha256: "e21cd63169a0e410f0671579bffdeee345a711a56ee78c12d3567bc7e63a37eb" },
  { package: PACKAGE_NAMES[0], subpath: "./session/testing", kind: "declaration", sha256: "2b6527b390774a8a82fb17dd93022caccd41f3d5b5b383dd47ab416f65c2332f" },
  { package: PACKAGE_NAMES[0], subpath: "audit:harness-scaffold", kind: "runtime", sha256: "21fdb3355adafd53c26337617a73918ba49e9832c42cde8b71c469abeecb5916" },
  { package: PACKAGE_NAMES[0], subpath: "audit:harness-scaffold", kind: "declaration", sha256: "3ceafcd72816bc8312f3f851625c082ae0b9099821fb3329e6ff9df165033472" },
  { package: PACKAGE_NAMES[1], subpath: ".", kind: "runtime", sha256: "2317a3ec8d3b0474e45d6c5cca04c71d3795c21bf83c08008c5a0869f9f33d95" },
  { package: PACKAGE_NAMES[1], subpath: ".", kind: "declaration", sha256: "defc58571d6d5c9623e57c0dbb4db4c09687b205b539bd8b2a989377170b1799" },
  { package: PACKAGE_NAMES[3], subpath: ".", kind: "runtime", sha256: "82cb4ea864f3d8816c06bc8f2f2d9a8d82d883297af179dc69d287d042834844" },
  { package: PACKAGE_NAMES[3], subpath: ".", kind: "declaration", sha256: "fd58aa17ec9ef58367c0068c46181ae086ab2dbfe12ae744bc104b68da17d4cf" },
];

const BOUNDARIES: EarendilBoundaryEvidence[] = [
  { id: "EB-01", name: "models and credentials", compileStatus: "pass", runtimeStatus: "unsupported", evidence: "ModelRuntime and FileCredentialStore assign directly; harness prompt/deferred execution is unavailable." },
  { id: "EB-02", name: "tools and context", compileStatus: "fail", runtimeStatus: "unsupported", evidence: "Root factories and generic tools exist, but non-generic AgentHarnessOptions accepts incompatible released-v2 HarnessTool values." },
  { id: "EB-03", name: "resources and hooks", compileStatus: "fail", runtimeStatus: "unsupported", evidence: "Resources compile directly; typed v3 hook/event maps are absent and scaffold registries reject registration." },
  { id: "EB-04", name: "telemetry", compileStatus: "pass", runtimeStatus: "unsupported", evidence: "Public telemetry types and schemas compile; no harness lifecycle can emit the required evidence." },
  { id: "EB-05", name: "harness session storage and events", compileStatus: "fail", runtimeStatus: "unsupported", evidence: "Required v3 constructor/storage/usage/event exports are absent and execution/restore/watch/manual drive reject." },
];

const CAPABILITIES: EarendilCapabilityEvidence[] = [
  { id: "HC-001", name: "simple prompt", requirement: "Acceptance precedes provider effects; terminal settlement yields one result and lane.lastResult.", status: "unsupported", operations: ["prompt"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-002", name: "tool prompt", requirement: "Tool effect_pending commits before execution; tool result and final run settle once.", status: "unsupported", operations: ["prompt"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-003", name: "parallel tools", requirement: "Parallel effects may complete out of order while durable results commit in source order.", status: "unsupported", operations: ["prompt"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-004", name: "safe replay", requirement: "Restore re-executes effect_pending only when persisted and current declarations both say safe.", status: "unsupported", operations: ["create.restore"], missingExports: ["Storage", "Transaction"], reason: "restore_not_implemented" },
  { id: "HC-005", name: "never replay", requirement: "Restore settles a never-replay tool under its reserved result ID without re-execution.", status: "unsupported", operations: ["create.restore"], missingExports: ["Storage", "Transaction"], reason: "restore_not_implemented" },
  { id: "HC-006", name: "steer", requirement: "An active operation owns accepted steer until one placement transaction consumes it.", status: "unsupported", operations: ["steer"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-007", name: "follow-up", requirement: "Follow-up stays operation-owned and executes after current work according to queue mode.", status: "unsupported", operations: ["followUp"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-008", name: "next run", requirement: "Lane pendingNextRun survives cleanup and one later operation captures it once.", status: "unsupported", operations: ["nextRun"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-009", name: "abort", requirement: "Cancellation commits before signal pull; late effects cannot create a second terminal settlement.", status: "unsupported", operations: ["abort"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-010", name: "compaction", requirement: "Manual threshold and overflow compaction preserve structural preparation and result state.", status: "unsupported", operations: ["compact"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-011", name: "retry", requirement: "Captured retry policy options and attempt progression survive restore with specified effective options.", status: "unsupported", operations: ["prompt"], missingExports: [], reason: "partial_scaffold_is_not_capability" },
  { id: "HC-012", name: "suspension", requirement: "Deferred missing-identity and crash suspension report the current operation and resume safely.", status: "unsupported", operations: ["resume", "create.restore"], missingExports: [], reason: "restore_not_implemented" },
  { id: "HC-013", name: "restore", requirement: "Bounded current-register reads reconstruct open state without folding full history.", status: "unsupported", operations: ["create.restore"], missingExports: ["Storage", "Transaction"], reason: "restore_not_implemented" },
  { id: "HC-014", name: "corruption", requirement: "Invalid current-register and reference combinations fail without silent repair.", status: "unsupported", operations: [], missingExports: ["Storage", "Transaction"], reason: "missing_v3_surface" },
  { id: "HC-015", name: "lane isolation", requirement: "Operations configuration and queues do not cross named lanes.", status: "unsupported", operations: ["createLane", "lane", "lanes"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-016", name: "close", requirement: "Close writes nothing rejects new work drains admitted commits and leaves open work resumable.", status: "unsupported", operations: [], missingExports: [], reason: "partial_scaffold_is_not_capability" },
  { id: "HC-017", name: "manual drive", requirement: "Manual and automatic drive yield identical durable state while one action advances at a time.", status: "unsupported", operations: ["peekAction", "executeAction", "runToCompletion"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-018", name: "hooks events and watch", requirement: "Typed hooks obey settlement barriers and snapshot-first buffered event ordering.", status: "unsupported", operations: ["hooks.on", "events.on", "watch", "watchSession"], missingExports: ["HarnessEventBus"], reason: "harness_not_implemented" },
  { id: "HC-019", name: "usage", requirement: "Each settled attempt has one UsageRow and totals equal the non-duplicated ledger sum.", status: "unsupported", operations: ["recordUsage"], missingExports: ["UsageRow"], reason: "missing_v3_surface" },
  { id: "HC-020", name: "deferred provider", requirement: "One poll per resume preserves handle lineage and cancel/restart outcomes.", status: "unsupported", operations: ["resume"], missingExports: [], reason: "harness_not_implemented" },
];

const PROMOTION_CRITERIA = [
  { id: "PG-01", requirement: "Select one separately approved coherent tagged Earendil package family with exact integrities." },
  { id: "PG-02", requirement: "Replace provisional negative expectations with direct assignments to the selected public types." },
  { id: "PG-03", requirement: "Run HC-001 through HC-020 against the real public constructor only." },
  { id: "PG-04", requirement: "Pass unchanged Memory and JSONL conformance plus an approved durable backend/runtime boundary." },
  { id: "PG-05", requirement: "Prove intent admission settlement restart and lane.lastResult semantics." },
  { id: "PG-06", requirement: "Prove open-operation migration backend faults precise rewrite and backup restore." },
  { id: "PG-07", requirement: "Preserve EF-S01 EF-S02 EF-S05 and EF-S08 Piclaw authority boundaries." },
  { id: "PG-08", requirement: "Pass PC golden scheduler mobile Abort SSE reconnect backup and rollback gates." },
  { id: "PG-09", requirement: "Obtain separate approval for Harness activation callers schemas and convergence." },
] as const;

const RAW_MANIFEST = {
  schemaVersion: 2,
  authority: {
    currentRuntimeVersion: "0.84.4",
    harnessBaselineVersion: "0.84.1",
    harnessCandidateVersion: "0.84.4",
    harnessCandidateSelection: "rejected_evidence_only",
    unsupportedCountsAsPass: false,
    harnessActivation: "latent_only",
    designCommit: "5f7195c51eac43cdf329f813a7ef020d7bd74527",
    draftEvidenceCommit: "fd389abc4677b4e0fa5dc9b2bbd2e63418f079b4",
  },
  releases: [
    {
      role: "historical_harness_baseline",
      tag: "v0.84.1",
      commit: "53fa77ccd8a279eb87e92294ef3687b03ff80112",
      runtimeSelection: "historical",
      harnessSelection: "baseline_evidence",
      packages: packageRows("0.84.1", "53fa77ccd8a279eb87e92294ef3687b03ff80112"),
      fingerprints: BASELINE_FINGERPRINTS,
      conformance: {
        caseCount: 29,
        catalogueSha256: "5b95af47d991cf4011f7fe42c6229779860d4ec5a5977cc16e7cf654ba170d96",
        auditedResultSha256: "03558673796deb901885963ed07be1c519990969fb8711e4b595f733b5bcfd70",
        memory: "historical_pass",
        jsonl: "historical_pass",
        sqlite: "unsupported",
        sqliteReason: "package_not_installed",
      },
    },
    {
      role: "current_runtime_harness_candidate",
      tag: "v0.84.4",
      commit: "b79e4cc834970cca69daebffab7df1da7d1e52c4",
      runtimeSelection: "installed",
      harnessSelection: "rejected_evidence_only",
      packages: packageRows("0.84.4", "b79e4cc834970cca69daebffab7df1da7d1e52c4"),
      fingerprints: CANDIDATE_FINGERPRINTS,
      conformance: {
        caseCount: 30,
        catalogueSha256: "46636aec941f7bbd5fcec6b3aec2b8e43518a0482a1b7f4fd4c1d5197e69f387",
        auditedResultSha256: "f2c7e067e69daf3e730da4dcab2a0ca14bba31be462c81aa70af0ac10b43e504",
        memory: "pass",
        jsonl: "pass",
        sqlite: "unsupported",
        sqliteReason: "bun_node_sqlite_unavailable",
      },
    },
  ],
  boundaries: BOUNDARIES,
  capabilities: CAPABILITIES,
  promotionCriteria: PROMOTION_CRITERIA,
} as const satisfies EarendilHarnessCompatibilityManifest;

const CANONICAL_MANIFEST = deepFreeze(RAW_MANIFEST);

interface SnapshotState {
  nodes: number;
  readonly ancestors: object[];
  readonly issues: EarendilManifestIssue[];
}

/** Descriptor-safe exact normalization. It never invokes candidate accessors. */
export function normalizeEarendilHarnessCompatibilityManifest(candidate: unknown): EarendilManifestNormalizationResult {
  const state: SnapshotState = { nodes: 0, ancestors: [], issues: [] };
  const snapshot = snapshotData(candidate, "$", 0, state);
  if (state.issues.length > 0 || snapshot === INVALID) return failed(state.issues);
  const difference = firstDifference(snapshot, RAW_MANIFEST, "$");
  if (difference) {
    return failed([issue(difference.shape ? "closed_shape_mismatch" : "manifest_drift", difference.path, difference.message)]);
  }
  return Object.freeze({
    ok: true,
    value: CANONICAL_MANIFEST,
    issues: Object.freeze([]),
  });
}

const INVALID = Symbol("invalid-manifest-value");
const MAX_DEPTH = 20;
const MAX_NODES = 20_000;
const MAX_ARRAY_LENGTH = 2_000;
const MAX_RECORD_FIELDS = 200;
const MAX_STRING_LENGTH = 20_000;

function snapshotData(value: unknown, path: string, depth: number, state: SnapshotState): unknown | typeof INVALID {
  state.nodes += 1;
  if (state.nodes > MAX_NODES || depth > MAX_DEPTH) {
    state.issues.push(issue("excessive_input", path, "Manifest input exceeds deterministic size or depth bounds."));
    return INVALID;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length <= MAX_STRING_LENGTH) return value;
    state.issues.push(issue("excessive_input", path, "Manifest string exceeds the deterministic length bound."));
    return INVALID;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    state.issues.push(issue("invalid_value", path, "Manifest numbers must be finite."));
    return INVALID;
  }
  if (!value || typeof value !== "object") {
    state.issues.push(issue("invalid_value", path, "Manifest values must be JSON-domain data."));
    return INVALID;
  }
  if (state.ancestors.includes(value)) {
    state.issues.push(issue("cycle_rejected", path, "Cyclic manifest input is rejected."));
    return INVALID;
  }

  let descriptors: PropertyDescriptorMap;
  let prototype: object | null;
  let array: boolean;
  try {
    array = Array.isArray(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
    prototype = Object.getPrototypeOf(value);
  } catch (error) {
    void error;
    state.issues.push(issue("invalid_container", path, "Manifest container reflection failed."));
    return INVALID;
  }
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    state.issues.push(issue("invalid_container", path, "Manifest containers must be plain records or arrays."));
    return INVALID;
  }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key === "symbol")) {
    state.issues.push(issue("symbol_rejected", path, "Symbol fields are outside the closed manifest shape."));
    return INVALID;
  }
  if (keys.some((key) => {
    const descriptor = descriptors[key];
    return !descriptor || !("value" in descriptor);
  })) {
    state.issues.push(issue("accessor_rejected", path, "Accessor fields are rejected without invocation."));
    return INVALID;
  }

  state.ancestors.push(value);
  try {
    if (array) return snapshotArray(descriptors, path, depth, state);
    return snapshotRecord(descriptors, path, depth, state);
  } finally {
    state.ancestors.pop();
  }
}

function snapshotArray(descriptors: PropertyDescriptorMap, path: string, depth: number, state: SnapshotState): unknown | typeof INVALID {
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_ARRAY_LENGTH) {
    state.issues.push(issue("excessive_input", path, "Manifest arrays must have a bounded safe-integer length."));
    return INVALID;
  }
  const keys = Object.keys(descriptors);
  if (keys.some((key) => key !== "length" && !/^(0|[1-9]\d*)$/.test(key))) {
    state.issues.push(issue("invalid_container", path, "Manifest arrays may contain only canonical indexes."));
    return INVALID;
  }
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor)) {
      state.issues.push(issue("invalid_container", `${path}[${index}]`, "Sparse or accessor array indexes are rejected."));
      return INVALID;
    }
    const item = snapshotData(descriptor.value, `${path}[${index}]`, depth + 1, state);
    if (item === INVALID) return INVALID;
    output.push(item);
  }
  return output;
}

function snapshotRecord(descriptors: PropertyDescriptorMap, path: string, depth: number, state: SnapshotState): unknown | typeof INVALID {
  const keys = Object.keys(descriptors);
  if (keys.length > MAX_RECORD_FIELDS) {
    state.issues.push(issue("excessive_input", path, "Manifest record contains too many fields."));
    return INVALID;
  }
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor)) {
      state.issues.push(issue("accessor_rejected", `${path}.${key}`, "Accessor fields are rejected without invocation."));
      return INVALID;
    }
    const item = snapshotData(descriptor.value, `${path}.${key}`, depth + 1, state);
    if (item === INVALID) return INVALID;
    output[key] = item;
  }
  return output;
}

interface Difference { readonly path: string; readonly message: string; readonly shape: boolean }

function firstDifference(actual: unknown, expected: unknown, path: string): Difference | null {
  if (Object.is(actual, expected)) return null;
  if (typeof actual !== typeof expected || actual === null || expected === null) {
    return { path, message: "Manifest value differs from the closed accepted evidence.", shape: false };
  }
  if (typeof actual !== "object" || typeof expected !== "object") {
    return { path, message: "Manifest scalar differs from the closed accepted evidence.", shape: false };
  }
  if (Array.isArray(actual) !== Array.isArray(expected)) {
    return { path, message: "Manifest container kind differs from the closed shape.", shape: true };
  }
  const actualKeys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);
  if (actualKeys.join("\0") !== expectedKeys.join("\0")) {
    return { path, message: "Manifest fields, indexes, or deterministic order differ from the closed shape.", shape: true };
  }
  for (const key of expectedKeys) {
    const difference = firstDifference(
      ownDataValue(actual, key),
      ownDataValue(expected, key),
      Array.isArray(expected) ? `${path}[${key}]` : `${path}.${key}`,
    );
    if (difference) return difference;
  }
  return null;
}

function ownDataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value);
  }
  return Object.freeze(value);
}

function failed(issues: readonly EarendilManifestIssue[]): EarendilManifestNormalizationResult {
  return Object.freeze({ ok: false, value: null, issues: Object.freeze([...issues]) });
}

function issue(code: EarendilManifestIssueCode, path: string, message: string): EarendilManifestIssue {
  return Object.freeze({ code, path, message });
}

const NORMALIZED = normalizeEarendilHarnessCompatibilityManifest(RAW_MANIFEST);
if (!NORMALIZED.ok) throw new Error("The closed Earendil compatibility manifest is invalid.");

/** Inert accepted WP-3B evidence. It cannot select or activate an Earendil release. */
export const EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST = NORMALIZED.value;
