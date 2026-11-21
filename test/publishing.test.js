import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPublisher} from '../public/publishing.js';

const job=status=>({id:'existing-job',targets:{youtube:{status}}});
test('one Continue action runs session creation and every chunk without duplicate loops',async()=>{
  let calls=0;
  const updates=[],delays=[];
  const publisher=createPublisher({
    step:async(id,platform)=>{assert.equal(id,'existing-job');assert.equal(platform,'youtube');return job(++calls===5?'Awaiting submission':'Publishing');},
    onUpdate:j=>updates.push(j.targets.youtube.status),sleep:async ms=>delays.push(ms)
  });
  const first=publisher.run('existing-job','youtube');
  assert.equal(publisher.isActive('existing-job','youtube'),true);
  assert.equal(publisher.run('existing-job','youtube'),first);
  await first;
  assert.equal(calls,5);assert.equal(updates.at(-1),'Awaiting submission');
  assert.equal(delays.length,4);assert.equal(publisher.isActive('existing-job','youtube'),false);
});
test('publishing errors stop the loop and allow resuming the same job',async()=>{
  let calls=0;
  const publisher=createPublisher({step:async()=>{if(++calls===1)throw Error('Upload interrupted');return job('Published');},onUpdate:()=>{},sleep:async()=>{}});
  await assert.rejects(publisher.run('existing-job','youtube'),/Upload interrupted/);
  assert.equal(publisher.isActive('existing-job','youtube'),false);
  await publisher.run('existing-job','youtube');assert.equal(calls,2);
});
test('uncertain submissions and exhausted polling do not loop indefinitely',async()=>{
  let calls=0;
  const stopped=createPublisher({step:async()=>{calls++;return job('Check submission');},onUpdate:()=>{},sleep:async()=>{}});
  await stopped.run('existing-job','youtube');assert.equal(calls,1);
  const bounded=createPublisher({step:async()=>job('Publishing'),onUpdate:()=>{},sleep:async()=>{},maxSteps:2});
  await assert.rejects(bounded.run('existing-job','youtube'),/Click (?:Publish|Continue)/);
  assert.equal(bounded.isActive('existing-job','youtube'),false);
});
test('Uploaded status waits 3s polling interval like Processing on YouTube',async()=>{
  let calls=0;
  const delays=[];
  const publisher=createPublisher({
    step:async()=>{
      calls++;
      if(calls===1)return job('Uploaded');
      return job('Published');
    },
    onUpdate:()=>{},
    sleep:async ms=>delays.push(ms)
  });
  await publisher.run('existing-job','youtube');
  assert.equal(calls,2);
  assert.deepEqual(delays,[3000]);
});
test('hasActive returns true during upload and false after completion',async()=>{
  let resolveStep;
  const stepPromise=new Promise(resolve=>{resolveStep=resolve;});
  const publisher=createPublisher({
    step:()=>stepPromise.then(()=>job('Published')),
    onUpdate:()=>{},
    sleep:async()=>{}
  });
  assert.equal(publisher.hasActive(),false);
  const task=publisher.run('job-1','youtube');
  assert.equal(publisher.hasActive(),true);
  resolveStep();
  await task;
  assert.equal(publisher.hasActive(),false);
});
