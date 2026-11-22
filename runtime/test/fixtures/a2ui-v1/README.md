# A2UI v1.0 reference fixtures

The JSON schemas are unchanged from [a2ui-project/a2ui@5ff1b05f02d39f969b52a942e78e864ef3ac01fa](https://github.com/a2ui-project/a2ui/tree/5ff1b05f02d39f969b52a942e78e864ef3ac01fa/specification/v1_0). `basic-catalog.json` is `catalogs/basic/v1/catalog.json` from the repository root; the remaining schemas are from `json/`. `protocol-examples.json` contains JSON blocks extracted from `docs/a2ui_protocol.md`, keyed by the opening fence's line number. See `LICENSE` and `SHA256SUMS`.

Tests resolve the schema's `catalog.json` placeholder locally. The upstream `test/testing_catalog.json` supplies schema-only declarations for the two RPC fixture suites. `cases/` contains unchanged data from the upstream test runner. The test uses a separate validator and a peer that reads SSE and writes HTTP/JSON without the Piclaw browser client or A2UI SDK. Piclaw uses its own HTTP/SSE binding, not the optional A2A binding.
