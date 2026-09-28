/** Frozen offline query-rewrite candidate; not a production tool or no-answer classifier. */
const STOP=new Set('a an and or the is are at of for to in on what when where how which with does do should'.split(' '));
/** Bound candidate expansion to query schema; quoted anchors remain literal FTS phrases. */
export function expandNoteQuery(input:string, variant:'expanded'|'anchored'|'anchored-two'|'ranked'|'head'='expanded'): string | null {
  const normal=input.replace(/[“”]/g,'"');
  if(Buffer.byteLength(normal)>512 || (normal.match(/"/g)?.length??0)%2) return null;
  const tokens=[...normal.matchAll(/"([^"\n]+)"|([\p{L}\p{N}_]+(?:[-./][\p{L}\p{N}_]+)*)/gu)]
    .map(m=>m[1]??m[2]!)
    .filter(token=>!STOP.has(token.toLocaleLowerCase('und')));
  if(!tokens.length || tokens.length>20) return null;
  const unique=[...new Set(tokens)].map(token=>`"${token.replaceAll('"','""')}"`);
  const expression=(variant==='expanded'||variant==='ranked')||unique.length<3 ? unique.join(' OR ')
    : variant==='anchored' ? `${unique[0]} AND (${unique.slice(1).join(' OR ')})`
    : variant==='head' ? `${unique[0]} AND ${unique[1]} AND ${unique[2]}`
    : `${unique[0]} AND ${unique[1]} AND (${unique.slice(2).join(' OR ')})`;
  return expression.length<=512?expression:null;
}
