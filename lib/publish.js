import {publishYouTube} from './youtube-publish.js';
import { fail, downloadURL } from './storage.js';

async function checked(url, options={}, label='Provider') {
  const res=await fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(25000)});
  if (!res.ok) throw fail(502,label+' returned HTTP '+res.status+'. Check the connection and retry.');
  return res;
}
async function instagram(channel,job,dest,checkpoint) {
  const root='https://graph.facebook.com/'+(process.env.META_GRAPH_VERSION || 'v23.0')+'/';
  const headers={Authorization:'Bearer '+channel.instagram};
  const post=async(path,params)=>(await checked(root+path,{method:'POST',headers,body:new URLSearchParams(params)},'Instagram')).json();
  const get=async(path,fields)=>(await checked(root+path+'?fields='+fields,{headers},'Instagram')).json();
  if(dest.mediaId) {
    const media=await get(dest.mediaId,'permalink');
    if(!media.permalink) throw fail(502,'Instagram has not returned a permalink yet.');
    dest.url=media.permalink;
  } else if(!dest.container) {
    dest.container=(await post(channel.instagramId+'/media',{media_type:'REELS',video_url:await downloadURL(job.key),caption:job.instagramDescription || job.caption || job.title})).id;
  } else {
    const {status_code}=await get(dest.container,'status_code');
    if(['ERROR','EXPIRED'].includes(status_code)) {delete dest.container; throw fail(422,'Instagram rejected the video or the container expired. Check the MP4 encoding.');}
    if(status_code==='PUBLISHED' || dest.publishAttempted) throw fail(409,'Verify the Reel on Instagram and attach its permalink in the dashboard before continuing.');
    if(status_code!=='FINISHED') return;
    dest.publishAttempted=true;
    await checkpoint();
    dest.mediaId=(await post(channel.instagramId+'/media_publish',{creation_id:dest.container})).id;
  }
}
export function validateEndpoint(endpoint) {
  let url;
  try {url=new URL(endpoint);} catch {throw fail(400,'Enter a valid campaign webhook URL.');}
  const hosts=(process.env.CAMPAIGN_WEBHOOK_HOSTS || '').toLowerCase().split(',').map(s=>s.trim());
  if(url.protocol!=='https:' || url.username || url.password || url.port || !hosts.includes(url.hostname)) throw fail(400,'Allow this HTTPS host in CAMPAIGN_WEBHOOK_HOSTS first.');
}
export async function advance(platform,channel,job,dest,checkpoint) {
  if(dest.done) return;
  if(platform==='youtube'){
    if(!await publishYouTube(channel,job,dest,checkpoint))return;
    await checkpoint();
  }else if(!dest.url) {
    await instagram(channel,job,dest,checkpoint);
    if(!dest.url) return;
    await checkpoint();
  }
  if(job.campaign && job.webhook) {
    validateEndpoint(job.webhook);
    const key=job.id+'-'+platform;
    await checked(job.webhook,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,...(job.webhookToken?{Authorization:'Bearer '+job.webhookToken}:{})},body:JSON.stringify({submission_id:key,campaign_id:job.campaign,channel:job.channel,platform,post_url:dest.url,video_id:job.id})},'Campaign webhook');
    dest.delivered=true;
  }
  dest.done=true;
  dest.publishedAt ||= new Date().toISOString();
}
