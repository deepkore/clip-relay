import {isIP} from 'node:net';
import {webhookSignature} from './worker-protocol.js';

export async function sendHomeWebhook(job,platform){
  const attemptedAt=new Date().toISOString();
  if(!process.env.HOME_WORKER_URL || !process.env.HOME_WORKER_SECRET)return {accepted:false,attemptedAt,error:'Configure HOME_WORKER_URL and HOME_WORKER_SECRET.'};
  try{
    const endpoint=new URL(process.env.HOME_WORKER_URL);
    if((endpoint.protocol!=='https:' && !(endpoint.protocol==='http:' && isIP(endpoint.hostname.replace(/^\[|\]$/g,'')))) || endpoint.username || endpoint.password || process.env.HOME_WORKER_SECRET.length<32)throw Error('Invalid configuration');
    const body=JSON.stringify({jobId:job.id,platform,rewardAccountId:job.rewardAccountId,url:job.targets[platform].url,campaignUrls:job.campaignUrls ?? [job.campaignUrl]});
    const timestamp=String(Date.now());
    const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-ClipRelay-Timestamp':timestamp,'X-ClipRelay-Signature':webhookSignature(process.env.HOME_WORKER_SECRET,timestamp,body)},body});
    const receipt=await response.json();
    if(!response.ok || receipt.accepted!==true || receipt.jobId!==job.id)throw Error('Receiver did not acknowledge');
    return {accepted:true,attemptedAt};
  }catch{return {accepted:false,attemptedAt,error:'Home PC did not acknowledge the webhook. Check the worker and IP/port, then resend from Activity.'};}
}
