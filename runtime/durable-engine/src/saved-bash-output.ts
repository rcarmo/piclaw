import {openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {defineDoc,type Harness,type ToolExecutionApi} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {currentTaskExecutionScope} from './task-model-boundary-shim.ts';
import type {SavedOutputRead} from './optimizer-output-source.ts';
export const SavedBashOutput=defineDoc<{file:{path:string;device:number;inode:number;size:number;modified:number}|null}>({kind:'app.bash-saved-output',version:1,scope:'task',initial:()=>({file:null}),checkpointWhen:()=>false});
/** Only the local guarded bash wrapper can mint a readable output reference. */
export async function retainBashOutputFile(api:Pick<ToolExecutionApi,'commit'|'taskId'>,path:string,check:()=>void){
 check();const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const stat=fstatSync(fd);if(!stat.isFile()||stat.uid!==process.getuid?.()||stat.nlink!==1)throw Error('Owned bash output file required');const file={path,device:stat.dev,inode:stat.ino,size:stat.size,modified:stat.mtimeMs};await api.commit(async tx=>{check();(await tx.doc(SavedBashOutput,api.taskId)).file=file;check();},context);}finally{closeSync(fd);}
}
export async function readOwnedBashOutput(harness:Harness,path:string,check:()=>void):Promise<SavedOutputRead>{
 check();const scope=currentTaskExecutionScope();if(!scope||scope.taskKind!=='pi.tool'||scope.phase!=='call')return{status:'unavailable'};scope.signal.throwIfAborted();
 const file=(await harness.snapshot(SavedBashOutput,scope.taskId,context))?.file;check();scope.signal.throwIfAborted();if(!file||file.path!==path)return{status:'unavailable'};
 let fd:number|undefined;
 try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const stat=fstatSync(fd);if(!stat.isFile()||stat.uid!==process.getuid?.()||stat.nlink!==1||stat.dev!==file.device||stat.ino!==file.inode||stat.size!==file.size||stat.mtimeMs!==file.modified)return{status:'unavailable'};
  const limit=4*1024*1024,bytes=Buffer.alloc(Math.min(limit,stat.size));let read=0;while(read<bytes.length){check();scope.signal.throwIfAborted();const count=readSync(fd,bytes,read,bytes.length-read,read);if(!count)break;read+=count;}
  check();scope.signal.throwIfAborted();const after=fstatSync(fd);if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.nlink!==1)return{status:'unavailable'};
  return{status:'available',text:bytes.subarray(0,read).toString('utf8'),truncated:read<stat.size};
 }catch(error){if(error&&typeof error==='object'&&'code'in error&&['ENOENT','ELOOP','EACCES','ENOTDIR','ESTALE','EIO'].includes(String(error.code)))return{status:'unavailable'};throw error;}
 finally{if(fd!==undefined)closeSync(fd);}
}
