import {describe,expect,test} from "bun:test";
import type {AgentMessage} from "@earendil-works/pi-agent-core";
import {parseRemoteCompactionDetails,getLatestRemoteCompactionDetails,extractRemoteCompactionReadableCheckpoint,REMOTE_COMPACTION_SUMMARY_SENTINEL,REMOTE_COMPACTION_DETAILS_KIND,REMOTE_COMPACTION_DETAILS_VERSION,type RemoteCompactionDetails} from "../../src/extensions/smart-compaction/remote-compaction.js";

function messages(): AgentMessage[] {
  return [
    { role: "user", content: "preserve this request", timestamp: 1 },
    { role: "assistant", content: [{ type: "text", text: "preserve this reply" }], api: "openai-responses", provider: "openai", model: "gpt-5.1", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 },
  ] as AgentMessage[];
}

function canonicalOutput(label = "opaque"): Array<Record<string, unknown>> {
  return [
    { type: "message", id: "retained", role: "user", content: [{ type: "input_text", text: label }] },
    { type: "compaction", id: "compact", encrypted_content: `encrypted-${label}` },
  ];
}

function details(overrides: Partial<RemoteCompactionDetails> = {}): RemoteCompactionDetails {
  return {
    kind: REMOTE_COMPACTION_DETAILS_KIND,
    version: REMOTE_COMPACTION_DETAILS_VERSION,
    adapter: "openai-responses-compact",
    provider: "openai",
    modelId: "gpt-5.1",
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    output: canonicalOutput(),
    fileOperations: { read: [], written: [], edited: [] },
    createdAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("historical remote compaction data",()=>{
  test("extracts only Piclaw's marked readable continuity checkpoint", () => {
    const persisted = details();
    persisted.output = [
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "do not expose" }] },
      {
        type: "message",
        role: "user",
        content: [{
          type: "input_text",
          text: "Earlier context was compacted locally. Preserve this continuity state together with the following events:\n\n## Goal\nKeep this checkpoint.",
        }],
      },
      { type: "compaction", encrypted_content: "encrypted-state" },
    ];

    expect(extractRemoteCompactionReadableCheckpoint(persisted)).toBe("## Goal\nKeep this checkpoint.");

    persisted.output[1] = {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Unmarked provider text" }],
    };
    expect(extractRemoteCompactionReadableCheckpoint(persisted)).toBeNull();
  });

  test("round-trips details from the latest branch compaction entry", () => {
    const persisted = details();
    expect(parseRemoteCompactionDetails(JSON.parse(JSON.stringify(persisted)))).toEqual(persisted);
    expect(getLatestRemoteCompactionDetails([
      { type: "message", id: "one", parentId: null, timestamp: "2026-07-15T00:00:00.000Z", message: messages()[0] },
      { type: "compaction", id: "two", parentId: "one", timestamp: "2026-07-15T00:00:01.000Z", summary: REMOTE_COMPACTION_SUMMARY_SENTINEL, firstKeptEntryId: "one", tokensBefore: 10, details: persisted },
    ] as any)).toEqual(persisted);
  });

  test("rejects truncated or unrecognized opaque details", () => {
    expect(parseRemoteCompactionDetails({ ...details(), output: [] })).toBeNull();
    expect(parseRemoteCompactionDetails({ ...details(), fileOperations: undefined })).toBeNull();
    expect(parseRemoteCompactionDetails({ ...details(), version: 2 })).toBeNull();
    expect(parseRemoteCompactionDetails({ ...details(), output: [{ type: "compaction", encrypted_content: "" }] })).toBeNull();
  });
});

test('historical parser preserves opaque objects and established usage normalisation without mutating source',()=>{
  const original=details({baseUrl:'https://api.openai.com/v1/',usage:{inputTokens:10,outputTokens:2,totalTokens:12}}),before=JSON.stringify(original);
  const parsed=parseRemoteCompactionDetails(original)!;
  expect(parsed.output).toEqual(original.output);expect(parsed.output[1]).toBe(original.output[1]);
  expect(parsed.baseUrl).toBe('https://api.openai.com/v1');expect(parsed.usage).toBeUndefined();
  const providerUsage=parseRemoteCompactionDetails({...original,usage:{input_tokens:10,output_tokens:2,total_tokens:12}})!;
  expect(providerUsage.usage).toEqual({inputTokens:10,outputTokens:2,totalTokens:12});
  expect(JSON.stringify(original)).toBe(before);
});

test('historical opaque validation retains file/record limits and rejects malformed metadata',()=>{
  for(const patch of [{adapter:'other'},{kind:'other'},{createdAt:null},{output:[null]},{output:[{type:'message'}]},{fileOperations:{read:[''],written:[],edited:[]}},{fileOperations:{read:'path',written:[],edited:[]}}])
    expect(parseRemoteCompactionDetails({...details(),...patch})).toBeNull();
  const file=details({fileOperations:{read:['a','a'],written:['b'],edited:['c']}});
  expect(parseRemoteCompactionDetails(file)!.fileOperations).toEqual({read:['a'],written:['b'],edited:['c']});
  expect(file.fileOperations.read).toEqual(['a','a']);
});
