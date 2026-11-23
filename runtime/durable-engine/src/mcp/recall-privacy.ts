import {recallStorageAllowed as upstreamAllowed} from './recall-privacy-upstream.ts';
// Explicit credential-header syntax is sensitive even when the token is short, synthetic or an unknown vendor format.
// Keep upstream exclusions and add this host restriction without changing the original invocation's value.
export function recallStorageAllowed(tool:string,raw:string){
 const text=raw.replaceAll('\\"','"');
 const header=/\b(?:proxy-authorization|authorization)\s*:\s*(?:Bearer|Basic)\s+\S+/i;
 const json=/["'](?:proxy-authorization|authorization)["']\s*:\s*["'](?:Bearer|Basic)\s+[^"'\s]+/i;
 return upstreamAllowed(tool,raw)&&!header.test(text)&&!json.test(text);
}
