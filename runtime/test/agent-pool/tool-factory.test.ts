import {expect,test} from 'bun:test';
import {AgentToolFactory} from '../../src/agent-pool/tool-factory.js';
for(const platform of ['linux','win32'] as const)test(`AgentToolFactory ${platform} has no competing default-tool selector`,()=>{
 const factory=new AgentToolFactory({workspaceDir:'/workspace',platform});
 expect('createDefaultTools' in factory).toBe(false);
 expect(factory.createCustomToolOverrides().map(tool=>tool.name)).toEqual(['grep']);
});
