import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';

test('PostgreSQL persists metadata, encrypts credentials and rejects stale writes',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
 process.env.ENCRYPTION_KEY=randomBytes(32).toString('hex');
 const {databasePool,schema,saveRecord,readRecord,listRecords,createUploadLog,updateUploadLog,readUploadLog}=await import('../lib/database.js');
 const pool=databasePool();
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query(schema);
  const kind='test-'+randomUUID();
  const name=kind+'/channel';
  const value={name:'PodPulse',youtube:'secret-refresh',campaignUrls:['campaign-a','campaign-b'],targets:{youtube:{session:'secret-upload-session'}},agentKey:'hashed-key'};
  const first=await saveRecord(name,value,undefined,client);
  const raw=(await client.query('SELECT data FROM cliprelay_records WHERE name=$1',[name])).rows[0].data;
  assert.equal(raw.name,'PodPulse');
  assert.ok(!JSON.stringify(raw).includes('secret-refresh'));
  assert.ok(!JSON.stringify(raw).includes('secret-upload-session'));
  assert.deepEqual((await readRecord(name,client)).value,value);
  assert.deepEqual(await listRecords(kind,client),[value]);
  await assert.rejects(saveRecord(name,value,undefined,client),{status:409});
  const updated={...value,name:'Updated'};
  await saveRecord(name,updated,first,client);
  await assert.rejects(saveRecord(name,value,first,client),{status:409});
  assert.equal((await readRecord(name,client)).value.name,'Updated');
  const upload={requestId:randomUUID(),channel:kind,campaignName:'campaign',hookText:'Hook',description:'Description',instagramDescription:'Instagram',youtubeDescription:'YouTube',videoKey:kind+'/campaign/test.mp4',thumbnailKey:kind+'/campaign/test.jpg'};
  const uploadId=await createUploadLog(upload,client);
  assert.notEqual(uploadId,upload.requestId);
  assert.equal(await createUploadLog(upload,client),uploadId);
  assert.equal((await readUploadLog(uploadId,client)).status,'pending');
  assert.equal((await readUploadLog(uploadId,client)).hookText,'Hook');
  assert.equal((await readUploadLog(uploadId,client)).description,'Description');
  assert.equal((await readUploadLog(uploadId,client)).instagramDescription,'Instagram');
  assert.equal((await readUploadLog(uploadId,client)).youtubeDescription,'YouTube');
  await assert.rejects(createUploadLog({...upload,hookText:'Changed'},client),{status:409});
  await assert.rejects(createUploadLog({...upload,requestId:randomUUID()},client),{status:409});
  await updateUploadLog(uploadId,'uploaded',{video:{uploaded:true},thumbnail:{uploaded:true}},client);
  assert.equal((await readUploadLog(uploadId,client)).status,'uploaded');
  process.env.ENCRYPTION_KEY=randomBytes(32).toString('hex');
  await assert.rejects(readRecord(name,client));
 }finally{
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
 }
});
