import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as server from '../lib/worker-protocol.js';
import * as worker from '../home-worker/lib/protocol.js';

test('standalone worker signatures bind method, path, account, instance and body',()=>{
 const secret='s'.repeat(64),timestamp=String(Date.now());
 const fields=['POST','/api/v1/worker/heartbeat','creator-a','instance','{"state":"idle"}'];
 const payload=worker.workerPayload(...fields);
 const signature=worker.webhookSignature(secret,timestamp,payload);
 assert.equal(server.verifyWebhook(secret,timestamp,server.workerPayload(...fields),signature),true);
 for(let i=0;i<fields.length;i++){
  const changed=[...fields];changed[i]+='tampered';
  assert.equal(server.verifyWebhook(secret,timestamp,server.workerPayload(...changed),signature),false);
 }
 assert.equal(server.verifyWebhook('other'.repeat(16),timestamp,payload,signature),false);
});
