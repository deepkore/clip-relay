import {read,save,fail} from './storage.js';

const instancePattern=/^[a-f0-9-]{36}$/;
const leaseMs=90000;
async function workerRecord(accountId){
  try{return await read('workers/'+accountId);}catch(e){if(e.status!==404)throw e;return null;}
}
export async function publicWorkerAccount(account){
  const worker=(await workerRecord(account.id))?.value;
  return {id:account.id,name:account.name,platform:account.platform,
    worker:worker?{online:worker.expires>Date.now(),lastSeen:worker.lastSeen,state:worker.state,hasBrowserProfile:typeof worker.hasBrowserProfile==='boolean'?worker.hasBrowserProfile:null}:null};
}
export async function assertWorkerLease(accountId,instance){
  const worker=(await workerRecord(accountId))?.value;
  if(!worker || worker.instance!==instance || worker.expires<=Date.now())throw fail(409,'Worker lease expired or belongs to another PC.');
}
export async function workerRequest(action,accountId,body){
  if(!instancePattern.test(body.instance || ''))throw fail(400,'Worker instance ID is required.');
  if(action==='heartbeat'){
    const current=await workerRecord(accountId);
    if(current?.value.expires>Date.now() && current.value.instance!==body.instance)throw fail(409,'Another worker is online for this reward account.');
    const state=['idle','submitting','needs-attention'].includes(body.state)?body.state:'idle';
    const hasBrowserProfile=typeof body.hasBrowserProfile==='boolean'?body.hasBrowserProfile:null;
    await save('workers/'+accountId,{instance:body.instance,expires:Date.now()+leaseMs,lastSeen:new Date().toISOString(),state,hasBrowserProfile},current?.tag);
    return {ok:true};
  }
  await assertWorkerLease(accountId,body.instance);
  if(action==='stop'){
    const current=await workerRecord(accountId);
    await save('workers/'+accountId,{...current.value,expires:0,state:'offline'},current.tag);
    return {ok:true};
  }
  throw fail(404,'Unknown worker action.');
}
