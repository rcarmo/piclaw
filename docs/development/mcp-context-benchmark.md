# Measure MCP context across a complete workflow

A synthetic Code Mode workflow used **77–90% fewer estimated tokens** when discovery, schema inspection and field selection stayed inside the script. It returned the same requested field and made exactly one MCP call in both variants. This is a fixture result, rather than a provider billing forecast.

Run the fixture with the checked-out SDK and standard local isolation:

```sh
bun run test:local -- bun runtime/durable-engine/qualification/benchmark-mcp-context.ts 5
```

The fixture tests 10, 100 and 1,000 tools, with recall Off, Observe and Active. Each combination alternates five paired, cold SQLite runs. The faux provider measures all requests, including discovery, final reply and any required recall. An in-process MCP stub returns 72 records with repetitive and varied Unicode text. The broad workflow emits the search results and the full tool result; Active recall then retrieves the necessary original pages. The targeted workflow searches and describes in the sandbox, validates the full structured value and emits one field. Both assert one remote-method invocation and the exact target.

| Tools | Recall | Estimated tokens, broad → targeted | Serialized request bytes, broad → targeted | Wall time p50/p95, milliseconds, broad → targeted |
|---:|---|---:|---:|---:|
| 10 | Off | 14,344 → 1,402 | 53,897 → 5,959 | 709/2,664 → 723/1,605 |
| 10 | Observe | 14,344 → 1,402 | 53,896 → 5,961 | 1,226/2,320 → 1,152/1,699 |
| 10 | Active | 6,287 → 1,402 | 102,489 → 5,961 | 3,724/4,960 → 1,564/1,821 |
| 100 | Off | 14,160 → 1,402 | 53,253 → 5,960 | 2,191/6,452 → 1,439/3,012 |
| 100 | Observe | 14,160 → 1,402 | 53,254 → 5,960 | 1,168/1,526 → 681/1,951 |
| 100 | Active | 6,011 → 1,402 | 101,518 → 5,960 | 2,094/2,830 → 640/730 |
| 1,000 | Off | 14,160 → 1,402 | 53,252 → 5,959 | 843/1,227 → 563/818 |
| 1,000 | Observe | 14,160 → 1,402 | 53,253 → 5,960 | 935/1,735 → 669/868 |
| 1,000 | Active | 6,011 → 1,402 | 101,519 → 5,960 | 1,638/3,325 → 650/983 |

Bytes include the SDK request’s stored result details. The SDK estimate counts model-visible content and tool declarations, not those private details. The fixture does not measure on-the-wire provider requests. At 1,000 tools, Active recall’s median live Code Mode checkpoint sample fell from about 542 to 505 KiB, and sampled heap growth from 13.0 to 5.9 MiB. The full SDK discovery snapshot remains the dominant checkpoint cost. Five samples provide a rough latency check; the 100-tool Observe tail and 10-tool Off median did not improve.

Ship the lower-context script guidance. Leave catalogue limits, provider transport, recall privacy scans and the SDK checkpoint format unchanged. The fixture makes no network or paid provider requests.
