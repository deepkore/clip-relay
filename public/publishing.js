const finished=new Set(['Published','Delivered','Awaiting submission','Check submission']);

// One click drives all steps, while the API checkpoints each resumable upload.
export function createPublisher({step,onUpdate,onState=()=>{},sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxSteps=360}){
  const active=new Map();
  function run(id,platform){
    const key=id+'/'+platform;
    if(active.has(key))return active.get(key);
    const task=Promise.resolve().then(async()=>{
      onState();
      try{
        for(let count=0;count<maxSteps;count++){
          const job=await step(id,platform);
          await onUpdate(job);
          const target=job.targets[platform];
          if(!target)throw Error('Publishing response is missing the selected platform.');
          if(finished.has(target.status))return job;
          if(target.needsPermalink || target.status==='Needs attention')throw Error(target.error || 'Publishing needs attention. Check Activity before continuing.');
          if(count+1<maxSteps)await sleep(platform==='youtube' && target.status!=='Processing on YouTube' && target.status!=='Uploaded'?1000:3000);
        }
        throw Error('Publishing is still pending. Click Publish to resume this same upload.');
      }finally{active.delete(key);onState();}
    });
    active.set(key,task);
    return task;
  }
  return {run,isActive:(id,platform)=>active.has(id+'/'+platform),hasActive:()=>active.size>0};
}
