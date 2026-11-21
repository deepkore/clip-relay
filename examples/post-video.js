import { openAsBlob } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {basename} from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const [channel, file, title, caption='',...campaignUrls]=process.argv.slice(2);
if(campaignUrls.length>1)throw Error('Provide only one campaign URL per video.');
const {RELAY_URL,RELAY_KEY}=process.env;
if(!channel || !file || !title || !RELAY_URL || !RELAY_KEY) {
  throw Error('Set RELAY_URL and RELAY_KEY, then run node examples/post-video.js <channel> <file.mp4> "<title>" ["caption"].');
}
const id=process.env.VIDEO_REQUEST_ID || randomUUID();
console.log('Request ID:',id,'— reuse as VIDEO_REQUEST_ID to resume this video.');
async function call(path,body) {
  const response=await fetch(new URL('/api/v1/'+path,RELAY_URL),{method:'POST',headers:{Authorization:'Bearer '+RELAY_KEY,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok) throw Object.assign(Error(data.error || 'Request failed'),{status:response.status});
  return data;
}
const video=await openAsBlob(file,{type:'video/mp4'});
if(!video.size || video.size>1024**3) throw Error('Provide an MP4 between 1 byte and 1 GiB.');
const thumbnailFile=process.env.THUMBNAIL_FILE;
const campaignName=process.env.CAMPAIGN_NAME;
if(thumbnailFile && !campaignName)throw Error('Set CAMPAIGN_NAME when supplying THUMBNAIL_FILE.');
const thumbnail=thumbnailFile?await openAsBlob(thumbnailFile,{type:'image/jpeg'}):null;
if(thumbnail && (!thumbnail.size || thumbnail.size>10*1024**2))throw Error('Provide a JPG between 1 byte and 10 MiB.');
const job=await call('videos',{channel,title,caption,hookText:process.env.HOOK_TEXT || '',description:process.env.VIDEO_DESCRIPTION || '',instagramDescription:process.env.INSTAGRAM_DESCRIPTION || '',youtubeDescription:process.env.YOUTUBE_DESCRIPTION || '',...(campaignUrls.length?{campaignUrl:campaignUrls[0]}:{}),...(campaignName?{campaignName,videoFileName:basename(file),...(thumbnailFile?{thumbnailFileName:basename(thumbnailFile)}:{})}:{})});
console.log('Database upload ID:',job.uploadId);
const put=await fetch(job.uploadUrl,{method:'PUT',headers:job.headers,body:video});
if(!put.ok && put.status!==412) throw Error('R2 upload returned HTTP '+put.status);
if(thumbnail){
  const result=await fetch(job.thumbnail.uploadUrl,{method:'PUT',headers:job.thumbnail.headers,body:thumbnail});
  if(!result.ok && result.status!==412)throw Error('Thumbnail upload returned HTTP '+result.status);
}
if(job.uploadId){
  const log=await call('videos/'+job.id+'/upload-complete',{});
  if(log.status!=='uploaded')throw Error('Upload incomplete: '+JSON.stringify(log.assets));
  console.log('Video and requested thumbnail verified in R2.');
}
for(const p of job.platforms){
  let failures=0;
  let pending;
  for(let step=0;step<360;step++){
    try {
      const result=await call('videos/'+job.id+'/publish/'+p,{});
      const d=result.targets[p];
      console.log(p,d.status,d.url || '');
      if(d.submissions?.some(s=>s.status==='Awaiting submission') || (result.campaignUrl && d.status==='Awaiting submission')) pending=result;
      if(d.status==='Check submission'){console.error('Resolve this submission in Activity.');process.exitCode=1;break;}
      if(['Delivered','Published','Awaiting submission'].includes(d.status))break;
      failures=0;
    } catch(e){
      if((e.status && e.status<500 && ![409,429].includes(e.status)) || ++failures>5)throw e;
    }
    if(step===359)throw Error('Polling limit reached. Resume with the same request ID.');
    await sleep(Math.min(60000,10000*2**failures));
  }
  if(pending)console.log(p,'Queued for the home worker.');
}
