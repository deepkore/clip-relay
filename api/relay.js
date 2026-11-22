import {channelCampaigns,normalizeCampaigns} from '../lib/campaigns.js';
import {uploadNames,verifyUploads} from '../lib/uploads.js';
import {verifyWebhook,workerPayload} from '../lib/worker-protocol.js';
import {sendHomeWebhook} from '../lib/home-webhook.js';
import {workerRequest,assertWorkerLease,publicWorkerAccount} from '../lib/home-worker.js';
import {rewardAccount,bindYouTube} from '../lib/reward-accounts.js';
import { sessionFor, login, logout, checkBrowserRequest } from '../lib/auth.js';
import { startYouTube, finishYouTube } from '../lib/youtube-oauth.js';
import { startInstagram, finishInstagram } from '../lib/instagram-oauth.js';
import { campaignPage } from '../lib/content-rewards.js';
import { randomBytes,randomUUID,createHash,timingSafeEqual } from 'node:crypto';
import { ready,fail,read,save,list,uploadURL,objectInfo,createUploadLog,readUploadLog } from '../lib/storage.js';
import { advance,validateEndpoint } from '../lib/publish.js';

const hash=value=>createHash('sha256').update(value).digest();
const same=(a,b)=>typeof a==='string' && typeof b==='string' && timingSafeEqual(hash(a),hash(b));
const slugPattern=/^[a-z0-9][a-z0-9-]{0,47}$/;
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const platforms=['youtube','instagram'];
function string(input,max,label) {
  if(typeof input!=='string' || input.length>max) throw fail(400,'Invalid '+label+'.');
  return input.trim();
}
function campaignList(record) {
  return record.campaigns?.map(c=>c.url) ?? record.campaignUrls ?? (record.campaignUrl ? [record.campaignUrl] : []);
}
function normalizeUrls(values) {
  if(!Array.isArray(values)) throw fail(400,'campaignUrls must be an array.');
  const urls=values.map(value=>typeof value==='string' && campaignPage(value));
  if(urls.some(url=>!url)) throw fail(400,'Enter a Content Rewards campaign page URL for each campaign.');
  return [...new Set(urls)];
}
function targetView(job,d) {
  const submissions=campaignList(job).map(campaignUrl=>{
    const state=d.submissions?.[campaignUrl] ?? (job.campaignUrl===campaignUrl ? d : {});
    const status=state.delivered?'Delivered':state.attempt?'Check submission':state.error?'Submission failed':d.done?'Awaiting submission':'Awaiting publication';
    return {campaignUrl,status,...(state.error?{error:state.error}:{})};
  });
  let status=d.error?'Needs attention':d.done?(d.delivered?'Delivered':job.campaign?'Awaiting submission':'Published'):d.url?'Submitting':job.bytes?'Publishing':'Awaiting publish';
  if(!d.done && !d.error && d.videoId){
    status=(d.uploadConfirmed || ['uploaded','processed'].includes(d.uploadStatus))?'Uploaded':'Processing on YouTube';
  }
  if(!d.done && !d.error && !d.videoId && job.scheduledAt){
    status='Scheduled';
  }
  if(d.done && submissions.length){
    status=submissions.every(s=>s.status==='Delivered')?'Delivered':submissions.some(s=>s.status==='Check submission')?'Check submission':submissions.some(s=>s.status==='Submission failed')?'Submission failed':'Awaiting submission';
  }
  const uploadConfirmed=Boolean(d.uploadConfirmed || ['uploaded','processed'].includes(d.uploadStatus) || d.done || d.url || d.processingStatus==='succeeded');
  const uploadStatus=d.uploadStatus || (uploadConfirmed ? 'processed' : undefined);
  return {status,submissions,url:d.url,error:d.error,uploadedBytes:d.uploadedBytes,totalBytes:job.bytes,shorts:d.shorts,processingStatus:d.processingStatus,uploadStatus,uploadConfirmed,homeDelivery:d.homeDelivery,needsPermalink:!!d.publishAttempted&&!d.mediaId,scheduledAt:job.scheduledAt,publishedAt:d.publishedAt};
}
const publicChannel=c=>({name:c.name,slug:c.slug,rewardAccountId:c.rewardAccountId,campaign:c.campaign,campaigns:channelCampaigns(c),campaignUrls:campaignList(c),campaignUrl:campaignList(c).length===1?campaignList(c)[0]:undefined,webhook:c.webhook,instagramId:c.instagramId,youtube:!!c.youtube,youtubeTitle:c.youtubeTitle,youtubeChannelId:c.youtubeChannelId,instagram:!!c.instagram,instagramTitle:c.instagramTitle,agentKey:!!c.agentKey,webhookToken:!!c.webhookToken});
function publicJob(j){
  const campaignUrls=campaignList(j);
  return {id:j.id,title:j.title,hookText:j.hookText || '',description:j.description || '',instagramDescription:j.instagramDescription || '',youtubeDescription:j.youtubeDescription || '',channel:j.channel,rewardAccountId:j.rewardAccountId,rewardPlatform:j.rewardPlatform,key:j.key,uploadId:j.uploadId,thumbnailKey:j.thumbnailKey,campaignName:j.campaignName,created:j.created,scheduledAt:j.scheduledAt,campaign:j.campaign,campaignUrls,campaignUrl:campaignUrls.length===1?campaignUrls[0]:undefined,targets:Object.fromEntries(Object.entries(j.targets).map(([p,d])=>[p,targetView(j,d)]))};
}
async function run(req,res){
  const url=new URL(req.url,'http://localhost');
  const route=(url.searchParams.get('route') || url.pathname.replace(/^\/api\/v1\/?/,'')).split('/').filter(Boolean);
  const [group,id,action,platform]=route;
  const method=req.method;
  if(group==='status' && method==='GET'){
    const required=['DATABASE_URL','ADMIN_TOKEN','ENCRYPTION_KEY','R2_ACCOUNT_ID','R2_BUCKET','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','APP_URL'];
    const missing=required.filter(name=>!process.env[name]?.trim());
    const invalid=[];
    if(process.env.ADMIN_TOKEN && process.env.ADMIN_TOKEN.length<24) invalid.push('ADMIN_TOKEN must have at least 24 characters');
    if(process.env.ENCRYPTION_KEY && !/^[a-f0-9]{64}$/i.test(process.env.ENCRYPTION_KEY)) invalid.push('ENCRYPTION_KEY must be 64 hexadecimal characters');
    return {configured:ready(),missing,invalid,storage:'postgres'};
  }
  if(!ready()) throw fail(503,'Set the workspace environment variables to enable live operations.');
  if(group==='oauth' && id==='youtube' && action==='callback' && method==='GET'){
    await finishYouTube(req,res,url);
    return;
  }
  if(group==='oauth' && id==='instagram' && action==='callback' && method==='GET'){
    await finishInstagram(req,res,url);
    return;
  }
  const body=typeof req.body==='string'?JSON.parse(req.body || '{}'):(req.body || {});
  if(group==='auth'){
    if(id==='login' && method==='POST') return login(req,res,body.token);
    if(id==='logout' && method==='POST') return logout(req,res);
    if(id==='session' && method==='GET') return {authenticated:!!await sessionFor(req)};
    throw fail(404,'Endpoint not found.');
  }
  const token=(req.headers.authorization || '').replace(/^Bearer /,'');
  const bearerAdmin=same(token,process.env.ADMIN_TOKEN);
  const isVercelCron=Boolean(process.env.CRON_SECRET && same(token,process.env.CRON_SECRET));
  const browserSession=!token?await sessionFor(req):null;
  const admin=bearerAdmin || isVercelCron || !!browserSession;
  if(browserSession && method!=='GET') checkBrowserRequest(req);
  let scope,workerAccount;
  if(!admin && req.headers['x-worker-account']){
    const accountId=req.headers['x-worker-account'];
    const raw=typeof req.body==='string'?req.body:(req.body?JSON.stringify(req.body):'');
    const payload=workerPayload(method,'/api/v1/'+route.join('/'),accountId,req.headers['x-worker-instance'],raw);
    if(!process.env.CLIPRELAY_SECRET || process.env.CLIPRELAY_SECRET===process.env.HOME_WORKER_SECRET || !verifyWebhook(process.env.CLIPRELAY_SECRET,req.headers['x-cliprelay-timestamp'],payload,req.headers['x-cliprelay-signature']))throw fail(401,'Invalid worker signature.');
    await rewardAccount(accountId);
    workerAccount=accountId;
    if(group==='worker' && method==='POST')return workerRequest(id,workerAccount,body);
    if(!(group==='videos' && uuid.test(id || '') && ((method==='GET' && !action) || (method==='POST' && action==='submission' && ['claim','confirm','fail'].includes(body.step)))))throw fail(403,'Workers can only read assigned uploads and submit rewards.');
  }
  if(!admin && !workerAccount){
    const match=/^cr_([a-z0-9-]{1,48})\.([a-f0-9]{64})$/.exec(token);
    if(!match) throw fail(401,'Enter a valid workspace or agent key.');
    const record=await read('channels/'+match[1]).catch(e=>{if(e.status!==404) throw e;});
    if(!record || !same(record.value.agentKey,hash(token).toString('hex'))) throw fail(401,'Invalid agent key.');
    scope=match[1];
  }

  const restricted=()=>{if(!admin) throw fail(403,'Workspace administrator access required.');};
  if(group==='uploads' && uuid.test(id || '') && method==='GET'){
    const log=await readUploadLog(id);
    if(scope && log.channel!==scope)throw fail(403,'Key belongs to another channel.');
    return log;
  }
  if(group==='overview' && method==='GET') {
    restricted();
    const [channels,jobs,rewardAccounts]=await Promise.all([list('channels'),list('jobs'),list('rewardAccounts')]);
    const accounts=await Promise.all(rewardAccounts.map(publicWorkerAccount));
    return {rewardAccounts:accounts,channels:channels.map(publicChannel),jobs:jobs.sort((a,b)=>b.created.localeCompare(a.created)).map(publicJob)};
  }
  if(group==='cron'){
    restricted();
    const today=new Date().toISOString().slice(0,10);
    if(id==='schedule' && (method==='GET' || method==='POST')){
      const [channels,jobs]=await Promise.all([list('channels'),list('jobs')]);
      const campaignMap=new Map();
      for(const job of jobs){
        const cName=job.campaignName || job.campaignUrl || job.campaign || 'uncategorized';
        if(!campaignMap.has(cName))campaignMap.set(cName,[]);
        campaignMap.get(cName).push(job);
      }
      const scheduled=[];
      for(const [cName,cJobs] of campaignMap.entries()){
        const alreadyPublished=cJobs.some(j=>{
          const targets=Object.values(j.targets || {});
          return targets.some(t=>(t.done || t.url || ['Published','Delivered','Awaiting submission','Check submission'].includes(t.status)) &&
            (t.publishedAt?t.publishedAt.slice(0,10)===today:(j.created && j.created.slice(0,10)===today)));
        });
        if(alreadyPublished)continue;
        const alreadyScheduled=cJobs.some(j=>j.scheduledAt && !Object.values(j.targets || {}).some(t=>t.done));
        if(alreadyScheduled)continue;
        const candidates=cJobs.filter(j=>{
          const targets=Object.values(j.targets || {});
          return (j.bytes || j.uploadId) && targets.some(t=>!t.done && !t.error);
        });
        if(!candidates.length)continue;
        candidates.sort((a,b)=>(a.created || '').localeCompare(b.created || ''));
        const picked=candidates[0];
        const targetDate=new Date();
        const isWeekend=targetDate.getUTCDay()===0 || targetDate.getUTCDay()===6;
        const defaultTime=isWeekend?'02:30':'00:30';
        const publishTimeStr=process.env.PUBLISH_TIME || defaultTime;
        const [h,m]=publishTimeStr.split(':').map(Number);
        targetDate.setUTCHours(isNaN(h)?(isWeekend?2:0):h,isNaN(m)?30:m,0,0);
        if(targetDate <= new Date()){
          targetDate.setUTCDate(targetDate.getUTCDate() + 1);
          const nextWeekend=targetDate.getUTCDay()===0 || targetDate.getUTCDay()===6;
          if(!process.env.PUBLISH_TIME){
            targetDate.setUTCHours(nextWeekend?2:0,30,0,0);
          }
        }
        const jobPath='jobs/'+picked.id;
        const current=await read(jobPath);
        current.value.scheduledAt=targetDate.toISOString();
        await save(jobPath,current.value,current.tag);
        scheduled.push({id:picked.id,title:picked.title,campaign:cName,channel:picked.channel,scheduledAt:current.value.scheduledAt});
      }
      return {ok:true,scheduledCount:scheduled.length,scheduled};
    }
    if(id==='publish' && (method==='GET' || method==='POST')){
      const now=new Date();
      let jobs=await list('jobs');
      let dueJobs=jobs.filter(j=>j.scheduledAt && new Date(j.scheduledAt)<=now && Object.values(j.targets || {}).some(t=>!t.done));
      if(!dueJobs.length){
        const campaignMap=new Map();
        for(const job of jobs){
          const cName=job.campaignName || job.campaignUrl || job.campaign || 'uncategorized';
          if(!campaignMap.has(cName))campaignMap.set(cName,[]);
          campaignMap.get(cName).push(job);
        }
        for(const [,cJobs] of campaignMap.entries()){
          const alreadyPublished=cJobs.some(j=>Object.values(j.targets || {}).some(t=>(t.done || t.url || ['Published','Delivered','Awaiting submission','Check submission'].includes(t.status)) && (t.publishedAt?t.publishedAt.slice(0,10)===today:(j.created && j.created.slice(0,10)===today))));
          if(alreadyPublished)continue;
          const candidates=cJobs.filter(j=>(j.bytes || j.uploadId) && Object.values(j.targets || {}).some(t=>!t.done && !t.error));
          if(!candidates.length)continue;
          candidates.sort((a,b)=>(a.created || '').localeCompare(b.created || ''));
          dueJobs.push(candidates[0]);
        }
      }
      const published=[],errors=[];
      for(const item of dueJobs){
        const jobPath='jobs/'+item.id;
        let current;
        try{current=await read(jobPath);}catch{continue;}
        let job=current.value;let tag=current.tag;
        if(!job.bytes){
          if(job.uploadId){
            const log=await verifyUploads(job);
            if(log.status==='uploaded')job.bytes=log.assets.video.bytes;
          }else{
            const info=await objectInfo(job.key);
            if(info)job.bytes=info.bytes;
          }
        }
        if(!job.bytes)continue;
        const channel=(await read('channels/'+job.channel)).value;
        const checkpoint=async()=>{tag=await save(jobPath,job,tag);};
        for(const platform of Object.keys(job.targets)){
          const d=job.targets[platform];
          if(d.done)continue;
          job.lease=Date.now()+120000;
          await checkpoint();
          try{
            delete d.error;
            const start=Date.now();
            while(!d.done && (Date.now()-start<40000)){
              await advance(platform,channel,job,d,checkpoint);
              if(d.done){
                d.publishedAt=new Date().toISOString();
                await checkpoint();
                break;
              }
              await new Promise(r=>setTimeout(r,2000));
            }
            if(d.done){
              if(campaignList(job).length){
                const res=await sendHomeWebhook(job,platform);
                const fresh=await read(jobPath);
                job=fresh.value;tag=fresh.tag;
                job.targets[platform].homeDelivery=res;
                await checkpoint();
              }
              published.push({id:job.id,title:job.title,platform,url:d.url});
            }
          }catch(err){
            d.error=err.message || 'Cron publishing failed.';
            await checkpoint();
            errors.push({id:job.id,platform,error:d.error});
          }finally{
            delete job.lease;
            await checkpoint();
          }
        }
      }
      return {ok:true,publishedCount:published.length,published,errors};
    }
    throw fail(404,'Unknown cron action.');
  }
  if(group==='reward-accounts' && method==='POST'){
    restricted();
    const accountId=id || body.id;
    if(!slugPattern.test(accountId || ''))throw fail(400,'Use lowercase letters, numbers and hyphens for the account ID.');
    const old=id?await read('rewardAccounts/'+id):null;
    if(action)throw fail(404,'Unknown reward account action.');
    if(body.platform && body.platform!=='contentrewards')throw fail(400,'Only Content Rewards is currently supported.');
    const name=string(body.name,100,'reward account name');
    if(!name)throw fail(400,'Reward account name is required.');
    const account={...old?.value,id:accountId,name,platform:'contentrewards'};
    await save('rewardAccounts/'+accountId,account,old?.tag);
    return publicWorkerAccount(account);
  }
  if(group==='channels' && method==='POST'){
    restricted();
    const slug=id || body.slug;
    if(!slugPattern.test(slug || '')) throw fail(400,'Use lowercase letters, numbers and hyphens for the folder.');
    const path='channels/'+slug;
    const old=id?await read(path):null;
    const c=old?.value || {slug};
    if(action==='youtube-connect') return startYouTube(slug,res);
    if(action==='instagram-connect') return startInstagram(slug,res);
    if(action==='key' || action==='revoke'){
      const key='cr_'+slug+'.'+randomBytes(32).toString('hex');
      c.agentKey=action==='key'?hash(key).toString('hex'):null;
      await save(path,c,old.tag);
      return action==='key'?{key}:{revoked:true};
    }
    if(action) throw fail(404,'Unknown channel action.');
    for(const field of ['name','campaign','webhook','instagramId','instagram','youtube','webhookToken','instagramTitle']) {
      if(body[field]!==undefined) c[field]=string(body[field],['name','campaign','instagramTitle'].includes(field)?100:4096,field);
    }
    if(body.rewardAccountId!==undefined){
      if(c.rewardAccountId && c.rewardAccountId!==body.rewardAccountId)throw fail(409,'A channel cannot switch reward accounts.');
      if(body.rewardAccountId){
        await rewardAccount(body.rewardAccountId);
        c.rewardAccountId=body.rewardAccountId;
      }
    }
    if(c.rewardAccountId && c.youtubeChannelId)await bindYouTube(c.youtubeChannelId,c.rewardAccountId);
    if(!c.name) throw fail(400,'Channel name is required.');
    if(c.instagram && !/^\d+$/.test(c.instagramId || '')) throw fail(400,'Enter the numeric Instagram professional account ID.');
    if(body.campaigns!==undefined){
      if(body.campaignUrls!==undefined || body.campaignUrl!==undefined)throw fail(400,'Send campaigns with names and URLs only.');
      c.campaigns=normalizeCampaigns(body.campaigns);
      delete c.campaignUrls;delete c.campaignUrl;
    }else if(body.campaignUrls!==undefined || body.campaignUrl!==undefined){
      const values=body.campaignUrls!==undefined?body.campaignUrls:(body.campaignUrl===''?[]:[body.campaignUrl]);
      const previous=channelCampaigns(c);
      c.campaigns=normalizeCampaigns(normalizeUrls(values).map(url=>previous.find(item=>item.url===url) || {name:new URL(url).pathname.split('/').filter(Boolean).at(-1),url}));
      delete c.campaignUrls;delete c.campaignUrl;
    }
    if(campaignList(c).length && c.webhook) throw fail(400,'Choose either browser delivery or a webhook.');
    if(c.webhook){validateEndpoint(c.webhook);if(!c.campaign) throw fail(400,'Enter the campaign ID.');}
    await save(path,c,old?.tag);
    return publicChannel(c);
  }
  if(group==='videos' && !id && method==='POST'){
    const channel=body.channel;
    if(!slugPattern.test(channel || '')) throw fail(400,'Provide a channel folder.');
    if(scope && channel!==scope) throw fail(403,'Key belongs to another channel.');
    const c=(await read('channels/'+channel)).value;
    const title=string(body.title,100,'video title');
    const caption=string(body.caption || '',2200,'caption');
    const hookText=string(body.hookText ?? '',500,'hookText');
    const description=string(body.description ?? '',5000,'description');
    const instagramDescription=string(body.instagramDescription ?? '',2200,'instagramDescription');
    const youtubeDescription=string(body.youtubeDescription ?? '',5000,'youtubeDescription');
    const targets=body.platforms ?? platforms.filter(p=>c[p]);
    if(!title || !Array.isArray(targets) || !targets.length || targets.some(p=>!platforms.includes(p) || !c[p])) throw fail(400,'Provide a title and at least one connected platform.');
    const jobId=req.headers['idempotency-key'] ?? randomUUID();
    if(!uuid.test(jobId)) throw fail(400,'Idempotency-Key must be a lowercase UUID.');
    const names=uploadNames(body);
    if(body.campaignUrl!==undefined && body.campaignUrls!==undefined)throw fail(400,'Send campaignUrl only, not both campaign fields.');
    const requested=body.campaignUrl!==undefined?normalizeUrls(body.campaignUrl===''?[]:[body.campaignUrl]):body.campaignUrls===undefined?undefined:normalizeUrls(body.campaignUrls);
    if(requested && requested.length>1)throw fail(400,'A video can belong to only one campaign. Send campaignUrl.');
    const path='jobs/'+jobId;
    const verifyExisting=prev=>{
      if(prev.channel!==channel || prev.title!==title || prev.caption!==caption || (prev.hookText || '')!==hookText || (prev.description || '')!==description || (prev.instagramDescription || '')!==instagramDescription || (prev.youtubeDescription || '')!==youtubeDescription || Object.keys(prev.targets).sort().join()!==[...new Set(targets)].sort().join() ||
        (requested && requested.toSorted().join()!==campaignList(prev).toSorted().join()) ||
        (names && (prev.campaignName?.toLowerCase()!==names.campaignName.toLowerCase() || (names.videoFileName!==undefined && prev.videoFileName!==names.videoFileName) || prev.thumbnailFileName!==names.thumbnailFileName))) throw fail(409,'Idempotency key already used.');
      return prev;
    };
    let job;
    try { job=verifyExisting((await read(path)).value); }
    catch(e){if(e.status!==404) throw e;}
    if(!job){
      const configured=channelCampaigns(c);
      const selected=names?.campaignName?configured.find(item=>item.name.toLowerCase()===names.campaignName.toLowerCase()):undefined;
      if(names?.campaignName && !selected)throw fail(400,'Unknown campaignName. Choose a named campaign configured on this channel.');
      if(selected && requested && (requested.length!==1 || requested[0]!==selected.url))throw fail(400,'campaignName and campaignUrl do not match.');
      const available=campaignList(c);
      if(!selected && !requested && available.length>1) throw fail(400,'Select a campaignName configured on this channel.');
      const campaignUrls=selected?[selected.url]:requested ?? available;
      if(campaignUrls.some(url=>!available.includes(url))) throw fail(400,'Choose campaigns associated with this channel.');
      if(campaignUrls.length){
        await rewardAccount(c.rewardAccountId);
        if(targets.includes('youtube'))await bindYouTube(c.youtubeChannelId,c.rewardAccountId);
      }
      const campaignName=selected?.name || configured.find(item=>item.url===campaignUrls[0])?.name || (campaignUrls.length===1?new URL(campaignUrls[0]).pathname.split('/').filter(Boolean).at(-1):c.campaign?.replace(/[^a-zA-Z0-9_-]/g,'-') || 'uncategorized');
      const videoFileName=names?.videoFileName || jobId+'.mp4';
      const thumbnailFileName=names?.thumbnailFileName;
      const key=channel+'/'+campaignName+'/'+videoFileName;
      const thumbnailKey=thumbnailFileName?channel+'/'+campaignName+'/'+thumbnailFileName:undefined;
      const uploadId=await createUploadLog({requestId:jobId,channel,campaignName,videoKey:key,thumbnailKey,hookText,description,instagramDescription,youtubeDescription});
      job={rewardAccountId:c.rewardAccountId,rewardPlatform:c.rewardAccountId?'contentrewards':undefined,id:jobId,title,caption,hookText,description,instagramDescription,youtubeDescription,channel,created:new Date().toISOString(),targets:Object.fromEntries(targets.map(p=>[p,{}])),key,thumbnailKey,uploadId,campaignName,videoFileName,thumbnailFileName,campaign:c.campaign,campaignUrls,webhook:c.webhook,webhookToken:c.webhookToken};
      try{await save(path,job);}catch(e){if(e.status!==409)throw e;job=verifyExisting((await read(path)).value);}
    }
    return {id:jobId,uploadId:job.uploadId,campaignName:job.campaignName,campaignUrl:campaignList(job)[0] || null,hookText:job.hookText || '',description:job.description || '',instagramDescription:job.instagramDescription || '',youtubeDescription:job.youtubeDescription || '',thumbnail:job.thumbnailKey?{objectKey:job.thumbnailKey,uploadUrl:await uploadURL(job.thumbnailKey,'image/jpeg'),headers:{'Content-Type':'image/jpeg','If-None-Match':'*'}}:undefined,objectKey:job.key,uploadUrl:await uploadURL(job.key),headers:{'Content-Type':'video/mp4','If-None-Match':'*'},platforms:targets};
  }
  if(group==='videos' && uuid.test(id || '')){
    const path='jobs/'+id;
    let {value:job,tag}=await read(path);
    if(workerAccount && job.rewardAccountId!==workerAccount)throw fail(403,'Upload belongs to another reward account.');
    if(scope && scope!==job.channel) throw fail(403,'Key belongs to another channel.');
    if(action==='upload-log' && method==='GET'){
      if(!job.uploadId)throw fail(404,'This legacy video has no upload log.');
      return readUploadLog(job.uploadId);
    }
    if(action==='upload-complete' && method==='POST'){
      if(!job.uploadId)throw fail(409,'This legacy video has no upload log.');
      return verifyUploads(job);
    }
    if(method==='GET' && !action){
      // Adopt an explicitly assigned account for jobs created before reward accounts existed.
      if(campaignList(job).length && !job.rewardAccountId){
        const c=(await read('channels/'+job.channel)).value;
        if(c.rewardAccountId){
          await rewardAccount(c.rewardAccountId);
          if(job.targets.youtube)await bindYouTube(c.youtubeChannelId,c.rewardAccountId);
          job.rewardAccountId=c.rewardAccountId;job.rewardPlatform='contentrewards';
          tag=await save(path,job,tag);
        }
      }
      return publicJob(job);
    }
    const d=job.targets[platform];
    if(method!=='POST' || !platforms.includes(platform) || !d || !['publish','permalink','submission','dispatch'].includes(action)) throw fail(404,'Unknown video action.');
    const checkpoint=async()=>{tag=await save(path,job,tag);};
    if(job.lease>Date.now()) throw fail(409,'Another publishing step is running. Retry shortly.');
    const dispatch=async()=>{
      if(!d.done || !d.url || !campaignList(job).length)return;
      const result=await sendHomeWebhook(job,platform);
      // Re-read because the receiver can confirm a submission while dispatch is in flight.
      const current=await read(path);job=current.value;tag=current.tag;
      job.targets[platform].homeDelivery=result;
      await checkpoint();
    };
    if(action==='dispatch'){
      if(!d.done || !campaignList(job).length)throw fail(409,'Publish this video before sending its campaign webhook.');
      await dispatch();return publicJob(job);
    }
    if(action==='submission'){
      await rewardAccount(job.rewardAccountId);
      const c=(await read('channels/'+job.channel)).value;
      if(c.rewardAccountId!==job.rewardAccountId)throw fail(409,'Reward account assignment does not match this upload.');
      if(platform==='youtube')await bindYouTube(c.youtubeChannelId,job.rewardAccountId);
      if(body.step==='claim' && body.rewardAccountId!==job.rewardAccountId)throw fail(409,'Worker reward account does not match this upload.');
      const urls=campaignList(job);
      const url=body.campaignUrl===undefined && urls.length===1?urls[0]:campaignPage(body.campaignUrl);
      if(!url || !urls.includes(url)) throw fail(400,'Select a campaign associated with this upload.');
      if(!d.done || !d.url) throw fail(409,'A published link for this browser campaign is required.');
      d.submissions ??= {};
      const state=d.submissions[url] ??= job.campaignUrl===url?{attempt:d.attempt,delivered:d.delivered}:{};
      if(body.step==='fail'){
        if(workerAccount)await assertWorkerLease(workerAccount,req.headers['x-worker-instance']);
        if(typeof body.error!=='string' || !body.error.trim() || body.error.length>2000)throw fail(400,'Provide a submission error of at most 2000 characters.');
        if(!state.delivered){
          if(state.attempt && (body.rejected===true || body.attempt) && !same(body.attempt,state.attempt))throw fail(409,'Submission failure does not match the current attempt.');
          state.error=body.error.trim();
          if(body.rejected===true)delete state.attempt;
          await checkpoint();
        }
        return publicJob(job);
      }
      if(body.step==='claim'){
        if(workerAccount)await assertWorkerLease(workerAccount,req.headers['x-worker-instance']);
        if(state.delivered || state.attempt || state.error) throw fail(409,'Submission already completed, failed or claimed. Check Content Rewards before retrying.');
        state.attempt=randomUUID();
        await checkpoint();
        return {attempt:state.attempt};
      }
      if(body.step==='resolve'){
        restricted();
        if(!state.attempt || state.delivered || !['received','absent'].includes(body.outcome)) throw fail(409,'No uncertain submission to resolve.');
        state.delivered=body.outcome==='received';
      }else if(body.step==='confirm'){
        if(!same(body.attempt,state.attempt)) throw fail(409,'Submission claim does not match.');
        state.delivered=true;
      }else throw fail(400,'Unknown submission step.');
      delete state.attempt;
      delete state.error;
      await checkpoint();
      return publicJob(job);
    }
    if(action==='permalink'){
      restricted();
      if(platform!=='instagram' || !d.publishAttempted || d.mediaId || !/^https:\/\/www\.instagram\.com\/(?:reel|p)\/[\w-]+\/?$/.test(body.url || '')) throw fail(400,'Enter the permalink of the published Reel.');
      d.url=body.url;delete d.error;d.publishAttempted=false;
      await checkpoint();return publicJob(job);
    }
    if(d.done){if(!d.homeDelivery?.accepted)await dispatch();return publicJob(job);}
    if(!job.bytes){
      if(job.uploadId){
        const log=await verifyUploads(job);
        if(log.status!=='uploaded')throw fail(409,'Upload all video and thumbnail files, then call upload-complete.');
        job.bytes=log.assets.video.bytes;
      }else{
        const info=await objectInfo(job.key);
        if(!info)throw fail(409,'Upload the MP4 to R2 first.');
        job.bytes=info.bytes;
      }
      if(!job.bytes || job.bytes>1024**3) throw fail(400,'Upload an MP4 between 1 byte and 1 GiB.');
    }
    const channel=(await read('channels/'+job.channel)).value;
    job.lease=Date.now()+120000;
    await checkpoint();
    try {delete d.error;await advance(platform,channel,job,d,checkpoint);}
    catch(e){d.error=e.status?e.message:'Provider request interrupted. Retry this publishing step.';throw fail(e.status || 502,d.error);}
    finally {delete job.lease;await checkpoint();}
    if(d.done)await dispatch();
    return publicJob(job);
  }
  throw fail(404,'Endpoint not found.');
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  try {const result=await run(req,res);if(!res.writableEnded)res.status(200).json(result);}
  catch(e){
    const status=e.status || (e instanceof SyntaxError?400:500);
    const reference=randomUUID();
    if(status>=500){
      // Log diagnostic identifiers only. Provider messages, request URLs and bodies can contain secrets.
      const identifier=value=>typeof value==='string'?value.replace(/[^a-zA-Z0-9_.:-]/g,'').slice(0,120):undefined;
      console.error('ClipRelay request failed',{
        reference,
        status,
        error:identifier(e.name),
        code:identifier(e.code || e.cause?.code),
        providerStatus:e.$metadata?.httpStatusCode,
        providerRequestId:identifier(e.$metadata?.requestId)
      });
    }
    const message=e.status?e.message:status===400?'Invalid JSON.':'Data request failed. Check the server configuration.';
    res.status(status).json({error:status>=500?message+' Reference: '+reference:message});
  }
}
