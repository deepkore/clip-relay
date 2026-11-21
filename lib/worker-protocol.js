import {createHmac,timingSafeEqual} from 'node:crypto';

export function webhookSignature(secret,timestamp,body){
  return createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex');
}
export function verifyWebhook(secret,timestamp,body,signature,now=Date.now()){
  if(!secret || secret.length<32 || !/^\d{13}$/.test(timestamp || '') || Math.abs(now-Number(timestamp))>300000 || !/^[a-f0-9]{64}$/.test(signature || ''))return false;
  return timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(webhookSignature(secret,timestamp,body),'hex'));
}
export function workerPayload(method,path,account,instance,body=''){
  return JSON.stringify(['cliprelay-worker-v1',method,path,account,instance,body]);
}
