# Audio attachment previews

Classic preview audio attachments with native browser controls, without
autoplay. The player loads metadata first. Download stays available if playback
fails or the browser cannot decode the file. Closing the preview stops playback,
releases its source and restores focus to the opener.

This completes the work proposed in #1349. The completion branch preserves the
contributor's commit (`22b94766b31f5cca95bdbcf7b08b61a697f299e9`, cherry-picked with
attribution); its generated bundles were rebuilt against `4a2e07259`.

## Formats and metadata

The shared policy in `runtime/src/utils/audio-media.ts` recognises these containers:

- MP3: `audio/mpeg`, with `audio/mp3` and `audio/x-mp3` aliases.
- M4A: `audio/mp4`, with `audio/x-m4a`.
- AAC: `audio/aac`, with `audio/x-aac`.
- FLAC: `audio/flac`, with `audio/x-flac`.
- Ogg/Opus: `audio/ogg` and `audio/opus`.
- WebM audio: `audio/webm`.
- WAV: `audio/wav`, with `audio/wave`, `audio/x-wav` and `audio/vnd.wave`.

Upload and path ingestion infer an audio MIME from `.mp3`, `.m4a`, `.aac`, `.flac`,
`.ogg`, `.oga`, `.opus`, `.weba` or `.wav` only when MIME is absent or generic
`application/octet-stream`. Explicit non-audio and unknown audio MIME types never
become inline audio merely because a filename has one of these extensions.
Existing generic rows use the same resolution when served. Stored rows are not
migrated. The allowlist describes metadata/container recognition; it does not
validate file bytes or guarantee browser codec support.

## Media HTTP contract

Existing authentication and family stored-message ownership checks run before
reading media or exposing size information. Caller-supplied owner/chat selectors
do not change media authority.

- Full GET returns `200`, `Accept-Ranges: bytes` and the full length.
- HEAD returns the full metadata with no body; it ignores Range.
- One closed, open-ended or suffix byte range returns `206`, exact bytes,
  `Content-Range` and exact `Content-Length`. End offsets clamp to stored size.
- Unsatisfiable, zero-suffix or unsafe-integer ranges return bodyless `416`,
  `Content-Range: bytes */size` and zero length.
- Malformed, non-byte and multipart ranges are ignored, returning full `200`.
- Unsafe/non-allowlisted MIME types retain attachment disposition on full,
  partial and HEAD responses. Invalid legacy header values become
  `application/octet-stream` with attachment disposition.
- Family responses retain private/no-store handling. Foreign and nonexistent
  IDs deny alike before exposing media size or range headers.

The handler slices the bounded stored Blob; it does not allocate memory from a
requested end offset. Storage still loads/decompresses the complete media blob
before slicing. This change adds seeking compatibility, not streaming storage.

## Validation

The September results below are historical evidence, including the retired second UI. Current regression coverage retains the Classic playback, seeking, download and focus cases.

The optional browser regression uses a disposable loopback server, an isolated
in-memory media database and generated 12-second WAV data. It never defaults to
the live server. The fixture cookie controls access to its media endpoint; separate
RequestRouterService tests exercise actual single-user routing and family
ownership enforcement.

```sh
bun run test:local --cwd runtime \
  --env PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1 \
  --env PLAYWRIGHT_BROWSERS_PATH=/absolute/browser-cache \
  -- bun test test/web/audio-preview.playwright.optional.test.ts
```

Evidence on 20 September 2026:

- 25 Chromium/WebKit browser cases, 406 assertions: Classic, 1200px/390px,
  light/dark settings, actual playback and six-second seek, decode failure,
  Download targets, keyboard opening/focus containment/restoration, Escape/close
  teardown, and pending/denied/unsafe metadata.
- Visual user, assistant, ID-only and MIME-only attachment paths; mixed
  `[image,audio]` and `[audio,image]` cases retain the image and play the correct ID.
- 90 focused media/security/classification tests, 568 assertions.
- Final `make ci-fast`: 5,451 runtime passes, four skips, 25 feature passes and
  nine web-build passes. Classic bundles rebuilt; four repository
  typechecks pass.
- An earlier full run failed the unchanged TOTP replay test when its repeated
  code calculation crossed a TOTP time step. Its isolated rerun and two subsequent
  full runs passed. The TOTP test was not changed.
- Supplemental checks have pre-existing failures: repository lint has 20
  diagnostics, import-boundary checking has 10, and standalone Visual `tsc` has
  80. Diagnostics match unchanged `main` at `4a2e07259` (Visual line numbers
  normalised for comparison). None was waived or rewritten for this feature.
- Bounded independent source review cleared after fixing mixed-media mapping and
  malformed legacy headers.

Linux WebKit is not physical Safari/iOS certification. The browser test decodes
WAV and exercises a broken MP3; it does not certify every allowlisted codec.
No installation, live data migration or restart is part of this change.
