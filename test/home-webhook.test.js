import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sendHomeWebhook} from '../lib/home-webhook.js';
import {webhookSignature,verifyWebhook} from '../lib/worker-protocol.js';
test('webhook rejects tampering, expired requests and invalid signatures',()=>{
 const secret='a'.repeat(64),body=JSON.stringify({jobId:'test'}),timestamp=String(Date.now());
 const signature=webhookSignature(secret,timestamp,body);
 assert.equal(verifyWebhook(secret,timestamp,body,signature),true);
 assert.equal(verifyWebhook(secret,timestamp,body+' ',signature),false);
 assert.equal(verifyWebhook(secret,timestamp,body,signature,Number(timestamp)+300001),false);
 assert.equal(verifyWebhook(secret,timestamp,body,'bad'),false);
});
test('webhook delivery requires receiver acknowledgement and preserves offline errors',async t=>{
 process.env.HOME_WORKER_URL='https://receiver.example/home-worker/webhook';process.env.HOME_WORKER_SECRET='b'.repeat(64);
 const job={id:'test',rewardAccountId:'creator',campaignUrls:['campaign'],targets:{youtube:{url:'https://youtube.com/watch?v=test'}}};
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(verifyWebhook(process.env.HOME_WORKER_SECRET,options.headers['X-ClipRelay-Timestamp'],options.body,options.headers['X-ClipRelay-Signature']),true);
  assert.equal(JSON.parse(options.body).url,job.targets.youtube.url);
  return {ok:true,json:async()=>({accepted:true,jobId:'test'})};
 });
 assert.equal((await sendHomeWebhook(job,'youtube')).accepted,true);
 process.env.HOME_WORKER_URL='http://192.168.1.10:4317/home-worker/webhook';
 assert.equal((await sendHomeWebhook(job,'youtube')).accepted,true);
 process.env.HOME_WORKER_URL='http://[2001:db8::10]:4317/home-worker/webhook';
 assert.equal((await sendHomeWebhook(job,'youtube')).accepted,true);
 process.env.HOME_WORKER_URL='ftp://192.168.1.10:4317/home-worker/webhook';
 assert.equal((await sendHomeWebhook(job,'youtube')).accepted,false);
 t.mock.method(globalThis,'fetch',async()=>{throw Error('offline');});
 assert.equal((await sendHomeWebhook(job,'youtube')).accepted,false);
 delete process.env.HOME_WORKER_URL;delete process.env.HOME_WORKER_SECRET;
});
