import '../../../helpers.ts';
import { expect, test } from 'bun:test';
import { applyA2uiMessages, bindA2uiDraftId, compileA2uiExpress } from '../../../../src/channels/web/a2ui/express.js';
import { CLASSIC_A2UI_AGENT_CAPABILITIES, CLASSIC_A2UI_RENDERER_CAPABILITIES } from '../../../../src/channels/web/a2ui/capabilities.js';
import { buildA2uiAction, validateA2uiAction } from '../../../../src/channels/web/a2ui/action.js';
import type { A2uiSnapshot } from '../../../../src/channels/web/a2ui/surface.js';

import { fixture, referenceValidator } from '../../../fixtures/a2ui-v1/schema.js';

const basic = await referenceValidator();
const testing = await referenceValidator('testing_catalog.json');

interface ReferenceCase {
  schema: string;
  catalog?: string;
  tests: { description: string; valid: boolean; data: Record<string, unknown> }[];
}

for (const file of ['button_checks','call_agent_function_message','call_function_message','checkable_components','contact_form_example_test','function_response','icon_checks','initial_state_validation','renderer_messages','tabs_checks','text_variants']) {
  const suite: ReferenceCase = await fixture(`cases/${file}.json`).json();
  const validate = (suite.catalog ? testing : basic)(suite.schema);
  for (const sample of suite.tests) {
    test(`upstream v1.0 / ${file}: ${sample.description}`, () => {
      expect(validate(sample.data), JSON.stringify(validate.errors)).toBe(sample.valid);
      if (suite.schema !== 'agent_to_renderer.json') return;
      const create = sample.data.createSurface as {surfaceId?: string} | undefined;
      // Upstream schema cases for updates are standalone. Classic also requires an existing surface.
      const update = sample.data.updateComponents as {surfaceId?: string} | undefined;
      const surfaceId = create?.surfaceId ?? update?.surfaceId;
      if (!surfaceId) return;
      const prior = update ? applyA2uiMessages(surfaceId,[{version:'1.0',createSurface:{surfaceId,
        catalogId:'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
      }}],undefined,true)! : undefined;
      const apply = () => applyA2uiMessages(surfaceId,[sample.data],prior,true);
      if (!sample.valid) expect(apply).toThrow();
      else expect(apply()?.surfaceId).toBe(surfaceId);
    });
  }
}

test('upstream contact form converges one envelope at a time and deletes its surface', async () => {
  const validate = basic('agent_to_renderer.json');
  const messages = (await fixture('cases/contact_form_example.jsonl').text()).trim().split('\n').map(line=>JSON.parse(line));
  let state: A2uiSnapshot | null | undefined;
  for (const [index,message] of messages.entries()) {
    expect(validate(message),JSON.stringify(validate.errors)).toBe(true);
    state = applyA2uiMessages('contact_form_1',[message],state ?? undefined,true);
    if (index === 0) expect(state?.components).toEqual([]);
    if (index === 1) expect(state?.components.find(component=>component.id==='submit_button')).toBeDefined();
    if (index === 2) expect(state?.dataModel).toMatchObject({contact:{email:'john.doe@example.com',subscribe:true}});
  }
  expect(state).toBeNull();
});

test('wire surface IDs are opaque and update/delete envelopes reject extra fields', async () => {
  const profiles = await fixture('protocol-examples.json').json();
  const validate=basic('agent_to_renderer.json');
  const surfaceId='urn:example:user-profile:42';
  const wire=Object.entries(profiles).filter(([line])=>['195','232','270','291'].includes(line)).map(([,message])=>{
    const [key]=Object.keys(message as object).filter(key=>key!=='version');
    return {version:'1.0',[key]:{...(message as Record<string,object>)[key],surfaceId}};
  });
  const rebound=bindA2uiDraftId(wire,'canonical');
  let prior: A2uiSnapshot | undefined;
  for (const message of rebound as Record<string,unknown>[]) {
    expect(validate(message),JSON.stringify(validate.errors)).toBe(true);
    const key=Object.keys(message).find(key=>key!=='version')!;
    if (key==='updateComponents' || key==='deleteSurface') {
      const invalid={...message,[key]:{...(message[key] as object),extra:true}};
      expect(validate(invalid)).toBe(false);
      expect(()=>applyA2uiMessages('canonical',[invalid],prior,true)).toThrow();
    }
    prior=applyA2uiMessages('canonical',[message],prior,true) ?? undefined;
    if (key==='updateDataModel') expect(prior?.dataModel).toHaveProperty('user.name','Jane Doe');
  }
  expect(prior).toBeUndefined();
});

test('model data is inert JSON even when its keys resemble v1.0 expressions', () => {
  const surfaceId='portable-form';
  const literal={'@call':'an arbitrary record key','@path':'not a binding','@catalogId':'a literal string'};
  const create={version:'1.0',createSurface:{surfaceId,catalogId:'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
    dataModel:{artifact:literal},components:[
      {id:'root',component:'Button',child:'title',action:{event:{name:'save',context:{record:{'@path':'/artifact'}}}}},
      {id:'title',component:'Text',text:'Save'},
    ],
  }};
  const validate=basic('agent_to_renderer.json');
  expect(validate(create),JSON.stringify(validate.errors)).toBe(true);
  const first=applyA2uiMessages(surfaceId,[create],undefined,true)!;
  const value={...literal,revision:2};
  const update={version:'1.0',updateDataModel:{surfaceId,path:'/artifact',value}};
  expect(validate(update)).toBe(true);
  const next=applyA2uiMessages(surfaceId,[update],first,true)!;
  const action=buildA2uiAction(next,'root',new Map(),'2026-06-02T08:57:23Z');
  expect(basic('renderer_to_agent.json')(action)).toBe(true);
  expect(validateA2uiAction(next,action).context).toEqual({record:value});
  const malformed={version:'1.0',updateComponents:{surfaceId,components:[{id:'title',component:'Text',text:literal}]}};
  expect(validate(malformed)).toBe(false);
  expect(()=>applyA2uiMessages(surfaceId,[malformed],next,true)).toThrow();
});

test('structured event literals stay inert beside relative expressions in a template', () => {
  const surfaceId='literal-context';
  const literal={config:[{'@call':'@index'},{'@path':'not an expression','@call':'arbitrary data'}]};
  const array=[{'@path':'relative name'}];
  const alias={path:'literal relative name'};
  const create={version:'1.0',createSurface:{surfaceId,catalogId:'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
    dataModel:{items:[{label:'First'},{label:'Second'}]},components:[
      {id:'root',component:'List',children:{componentId:'submit',path:'/items'}},
      {id:'submit',component:'Button',child:'label',action:{event:{name:'save',context:{literal,array,alias,name:{'@path':'label'}}}}},
      {id:'label',component:'Text',text:'Save'},
    ],
  }};
  const validate=basic('agent_to_renderer.json');
  expect(validate(create),JSON.stringify(validate.errors)).toBe(true);
  const created=applyA2uiMessages(surfaceId,[create],undefined,true)!;
  const surface=applyA2uiMessages(surfaceId,[{version:'1.0',updateDataModel:{surfaceId,path:'/items/1/label',value:'Edited'}}],created)!;
  const message=buildA2uiAction(surface,'submit',new Map(),'2026-06-02T08:57:23Z','/1');
  expect(basic('renderer_to_agent.json')(message)).toBe(true);
  expect(validateA2uiAction(surface,message,'/1').context).toEqual({alias,array,literal,name:'Edited'});
  const replacement={...create.createSurface.components[1],action:{event:{name:'updated',context:{kept:true}}}};
  const next=applyA2uiMessages(surfaceId,[{version:'1.0',updateComponents:{surfaceId,components:[replacement]}}],surface)!;
  expect(buildA2uiAction(next,'submit',new Map(),'2026-06-02T08:57:23Z','/1').action.context).toEqual({kept:true});
});

test('component IDs and function parameter names use the catalogues’ UAX #31 grammar', () => {
  const surfaceId='urn:example:unicode-components';
  const catalogId='https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
  const create=(id:string,args:Record<string,unknown>={label:'hello'})=>({version:'1.0',createSurface:{surfaceId,catalogId,components:[
    {id:'root',component:'Column',children:[id]},
    {id,component:'Text',text:{'@call':'lookUp',args}},
  ]}});
  expect(applyA2uiMessages(surfaceId,[create('名簿_٢')],undefined,true)?.components[1].id).toBe('名簿_٢');
  for (const id of ['1stItem','submit-form','a.b','two words','suffix\n']) {
    expect(()=>applyA2uiMessages(surfaceId,[create(id)],undefined,true)).toThrow();
  }
  expect(()=>applyA2uiMessages(surfaceId,[create('ordinary',{ 'invalid-arg':'hello' })],undefined,true)).toThrow();
  const dangling={version:'1.0',createSurface:{surfaceId,catalogId,components:[{id:'root',component:'Card',child:'1stItem'}]}};
  expect(()=>applyA2uiMessages(surfaceId,[dangling],undefined,true)).toThrow();
});

test('shipped Classic authoring examples compile and the wire example submits the selected row', async () => {
  const skill=(name:string)=>Bun.file(new URL(`../../../../../skel/.pi/skills/a2ui-express-authoring/${name}`,import.meta.url)).text();
  const docs=[await skill('SKILL.md'),await skill('templates.md')].join('\n');
  const examples=[...docs.matchAll(/```express\n([\s\S]*?)\n```/g)];
  expect(examples).toHaveLength(5);
  for (const [,express] of examples) expect(applyA2uiMessages('example',compileA2uiExpress(express,'example'))?.components.length).toBeGreaterThan(0);
  const [,json]=/```json\n([\s\S]*?)\n```/.exec(docs)!;
  const messages=JSON.parse(json) as unknown[];
  const validate=basic('agent_to_renderer.json');
  for (const message of messages) expect(validate(message),JSON.stringify(validate.errors)).toBe(true);
  const surface=applyA2uiMessages('example',bindA2uiDraftId(messages,'example'),undefined,true)!;
  const action=buildA2uiAction(surface,'pick',new Map(),'2026-06-02T08:57:23Z','/1');
  expect(basic('renderer_to_agent.json')(action)).toBe(true);
  expect(validateA2uiAction(surface,action,'/1')).toMatchObject({name:'choose_region',userMessage:'Chose South',
    context:{region:'South',position:2,source:{section:'handoff',tags:['region']}},
  });
});

test('Classic discovery and renderer offer match the pinned schemas', () => {
  const check = (schema: string, value: unknown) => {
    const validate=basic(`${schema}.json`);
    expect(validate(value),JSON.stringify(validate.errors)).toBe(true);
  };
  check('agent_capabilities',CLASSIC_A2UI_AGENT_CAPABILITIES);
  check('renderer_capabilities',CLASSIC_A2UI_RENDERER_CAPABILITIES);
});
