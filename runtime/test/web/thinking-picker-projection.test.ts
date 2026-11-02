import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { VNode } from 'preact';
const built=await Bun.build({entrypoints:[join(import.meta.dir,'../../web/static/visual/frontend/src/components/model-context-bar/ThinkingPicker.tsx')],target:'bun',jsx:{runtime:'automatic',importSource:'preact'}});
if(!built.success)throw Error(String(built.logs));
const {ThinkingPicker}=await import(`data:text/javascript;base64,${Buffer.from(await built.outputs[0].text()).toString('base64')}`);
function buttons(node:any):VNode<any>[] {
 if(Array.isArray(node))return node.flatMap(buttons);
 if(!node?.props)return [];
 return [...(node.props.role==='button'?[node]:[]),...buttons(node.props.children)];
}
const event=(key='')=>({key,preventDefault(){},stopPropagation(){}});
test('unknown backend thinking capabilities render no invented selectable levels or commands',()=>{
 const selected:string[]=[];
 const node=ThinkingPicker({thinkingLevels:[],currentLevel:'max',onSelectThinking:(level:string)=>selected.push(level)});
 expect(buttons(node)).toEqual([]);expect(selected).toEqual([]);
 expect(JSON.stringify(node)).toContain('Thinking levels unavailable.');
});
test('thinking picker preserves backend ordering, canonical keys, current selection and keyboard semantics',()=>{
 const selected:string[]=[];
 const nodes=buttons(ThinkingPicker({thinkingLevels:['medium','high','xhigh','max'],currentLevel:'max',onSelectThinking:(level:string)=>selected.push(level)}));
 expect(nodes.map(node=>node.props.children[1].props.children)).toEqual(['medium','high','xhigh','max']);
 expect(nodes.map(node=>node.props.tabIndex)).toEqual([0,0,0,0]);
 expect(nodes[2]!.props.className).not.toContain('--active');expect(nodes[3]!.props.className).toContain('--active');
 nodes[2]!.props.onKeyDown(event('Enter'));nodes[3]!.props.onKeyDown(event(' '));nodes[1]!.props.onClick(event());nodes[0]!.props.onKeyDown(event('Escape'));
 expect(selected).toEqual(['xhigh','max','high']);
});
