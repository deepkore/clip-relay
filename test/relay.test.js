import {webhookSignature,workerPayload} from '../lib/worker-protocol.js';
import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const records=new Map();
const uploadLogs=new Map(),objects=new Map();
const fail=(status,message)=>Object.assign(Error(message),{status});
mock.module('../lib/shorts.js',{namedExports:{inspectShorts:async()=>({width:1080,height:1920,duration:30,format:'shorts'})}});
mock.module('../lib/google-client.js',{namedExports:{youtubeClient:()=>{
 const request=async options=>{
  const res=await fetch(options.url,{method:options.method,headers:options.headers,body:options.data});
  if(res.status!==308 && !res.ok)throw Object.assign(Error('Google error'),{response:{status:res.status}});
  return {status:res.status,headers:res.headers,data:res.status===308?null:await res.json().catch(()=>null)};
 };
 return {auth:{request},youtube:{thumbnails:{set:async()=>({status:200,data:{}})},videos:{
  insert:async(params,options)=>{
   const res=await fetch(options.url+'?uploadType=resumable',{method:'POST',headers:options.headers,body:JSON.stringify(params.requestBody)});
   return {status:res.status,headers:res.headers,data:null};
  },
  list:async()=>({data:{items:[{status:{uploadStatus:'processed',privacyStatus:'public'},processingDetails:{processingStatus:'succeeded'}}]}})
 }}};
}}});
mock.module('../lib/storage.js',{namedExports:{
  createUploadLog:async input=>{let log=uploadLogs.get(input.requestId);if(!log){if([...uploadLogs.values()].some(l=>l.videoKey===input.videoKey || (input.thumbnailKey && l.thumbnailKey===input.thumbnailKey)))throw fail(409,'Filename used');log={...input,id:randomUUID(),status:'pending',assets:{}};uploadLogs.set(input.requestId,log);}return log.id;},
  readUploadLog:async id=>structuredClone([...uploadLogs.values()].find(l=>l.id===id)),
  updateUploadLog:async(id,status,assets)=>Object.assign([...uploadLogs.values()].find(l=>l.id===id),{status,assets}),
  objectInfo:async key=>objects.has(key)?objects.get(key):({bytes:3,contentType:key.endsWith('.jpg')?'image/jpeg':'video/mp4'}),
  fail,ready:()=>true,uploadURL:async key=>'https://storage.example/'+key,downloadURL:async()=>'https://storage.example/video',
  read:async name=>{if(!records.has(name))throw fail(404,'missing');return structuredClone(records.get(name));},
  save:async(name,value,tag)=>{const prev=records.get(name);if(prev?.tag!==tag)throw fail(409,'conflict');const next=randomUUID();records.set(name,{tag:next,value:structuredClone(value)});return next;},
  list:async type=>[...records.entries()].filter(([k])=>k.startsWith(type+'/')).map(([,r])=>r.value)
}});
const {default:handler}=await import('../api/relay.js');
process.env.ADMIN_TOKEN='admin-test';
process.env.CAMPAIGN_WEBHOOK_HOSTS='rewards.example';
async function call(path,token,body,id,headers={}){
  const req={url:'/api/v1/'+path,method:body?'POST':'GET',body,headers:{authorization:'Bearer '+token,'idempotency-key':id,...headers}};
  if(token?.account){
  const timestamp=String(Date.now()),instance=headers['x-worker-instance'] || body?.instance || '';
  const payload=workerPayload(req.method,'/api/v1/'+path,token.account,instance,body?JSON.stringify(body):'');
  req.headers={'x-worker-account':token.account,'x-worker-instance':instance,'x-cliprelay-timestamp':timestamp,'x-cliprelay-signature':webhookSignature(process.env.CLIPRELAY_SECRET,timestamp,payload),...headers};
 }
 const res={setHeader(){},status(n){this.code=n;return this;},json(data){this.data=data;}};
  await handler(req,res);return res;
}
test('channel isolation, idempotent uploads, Reel processing and campaign retry',async t=>{
 const admin=process.env.ADMIN_TOKEN;
 const channel={slug:'podpulse',name:'PodPulse',instagram:'test',instagramId:'123',campaign:'camp-1',webhook:'https://rewards.example/submit'};
 assert.equal((await call('channels',admin,channel)).code,200);
 const key=(await call('channels/podpulse/key',admin,{})).data.key;
 assert.equal((await call('overview',key)).code,403);
 const id=randomUUID();
 const payload={channel:'podpulse',title:'Hello',platforms:['instagram']};
 assert.equal((await call('videos',key,{...payload,channel:'other'},id)).code,403);
 const job=await call('videos',key,payload,id);
 assert.equal(job.data.objectKey,'podpulse/camp-1/'+id+'.mp4');
 assert.equal((await call('videos',key,payload,id)).data.id,id);
 assert.equal((await call('videos',key,{...payload,title:'Different'},id)).code,409);
 let published=0,deliveries=0;
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
   const address=String(url);
   if(address.endsWith('/media'))return Response.json({id:'container'});
   if(address.includes('?fields=status_code'))return Response.json({status_code:'FINISHED'});
   if(address.endsWith('/media_publish')){published++;return Response.json({id:'reel'});}
   if(address.includes('?fields=permalink'))return Response.json({permalink:'https://www.instagram.com/reel/abc/'});
   if(address.startsWith('https://rewards.example')){
     assert.equal(JSON.parse(opts.body).campaign_id,'camp-1');
     assert.equal(opts.headers['Idempotency-Key'],id+'-instagram');
     return new Response('',{status:++deliveries===1?503:200});
   }
   throw Error(address);
 });
 const step=()=>call('videos/'+id+'/publish/instagram',key,{});
 assert.equal((await step()).code,200);assert.equal((await step()).code,200);
 assert.equal((await step()).code,502);
 assert.equal((await step()).data.targets.instagram.status,'Delivered');
 assert.equal((await step()).code,200);assert.equal(published,1);assert.equal(deliveries,2);
 await call('channels/podpulse/revoke',admin,{});
 assert.equal((await call('videos/'+id,key)).code,401);
});
test('YouTube resumes from confirmed range and preserves final link',async t=>{
 const {advance}=await import('../lib/publish.js');
 let uploads=0;
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
   if(url.includes('oauth2'))return Response.json({access_token:'access'});
   if(url.includes('uploadType'))return new Response(null,{headers:{location:'https://google.example/session'}});
   if(opts.headers.Range){assert.equal(opts.headers.Range,'bytes=2-4');return new Response('abc',{status:206});}
   if(opts.headers['Content-Range']==='bytes */5')return new Response(null,{status:308,headers:{range:'bytes=0-1'}});
   assert.equal(opts.headers['Content-Range'],'bytes 2-4/5');uploads++;return Response.json({id:'published'});
 });
 const d={},j={title:'Clip',key:'test.mp4',bytes:5};
 for(let i=0;i<3;i++)await advance('youtube',{youtube:'refresh'},j,d,async()=>{});
 assert.equal(uploads,1);assert.equal(d.url,'https://www.youtube.com/shorts/published');assert.equal(d.done,true);
});

test('browser submission claims prevent duplicate clicks and support reconciliation',async()=>{
 const id=randomUUID();
 const path='jobs/'+id;
 const target={url:'https://www.youtube.com/watch?v=test',done:true};
 records.set('rewardAccounts/test-account',{tag:'account',value:{id:'test-account',name:'Test',platform:'contentrewards'}});
 records.get('channels/podpulse').value.rewardAccountId='test-account';
 records.get('channels/podpulse').value.youtubeChannelId='UCpodpulse';
 records.set(path,{tag:'initial',value:{rewardAccountId:'test-account',id,created:new Date().toISOString(),channel:'podpulse',campaignUrl:'https://contentrewards.com/c/campaigns/test',targets:{youtube:target}}});
 const action=body=>call('videos/'+id+'/submission/youtube',process.env.ADMIN_TOKEN,body);
 const reason='Posts have to be submitted within 30 minutes of going live.';
 const failed=await action({step:'fail',error:reason});
 assert.equal(failed.data.targets.youtube.status,'Submission failed');
 assert.equal(failed.data.targets.youtube.submissions[0].error,reason);
 assert.equal((await action({rewardAccountId:'test-account',step:'claim'})).code,409);
 delete records.get(path).value.targets.youtube.submissions['https://contentrewards.com/c/campaigns/test'].error;
 const claim=await action({rewardAccountId:'test-account',step:'claim'});
 assert.equal(claim.code,200);
 assert.equal((await action({rewardAccountId:'test-account',step:'claim'})).code,409);
 assert.equal((await action({step:'confirm',attempt:'wrong'})).code,409);
 assert.equal((await action({step:'fail',error:'Receipt not found'})).data.targets.youtube.status,'Check submission');
 assert.equal((await action({step:'resolve',outcome:'absent'})).data.targets.youtube.status,'Awaiting submission');
 const retry=await action({rewardAccountId:'test-account',step:'claim'});
 assert.notEqual(retry.data.attempt,claim.data.attempt);
 assert.equal((await action({step:'fail',error:reason,rejected:true,attempt:claim.data.attempt})).code,409);
 const rejected=await action({step:'fail',error:reason,rejected:true,attempt:retry.data.attempt});
 assert.equal(rejected.data.targets.youtube.status,'Submission failed');
 assert.equal(rejected.data.targets.youtube.submissions[0].error,reason);
 assert.equal((await action({step:'fail',error:reason,rejected:true,attempt:retry.data.attempt})).data.targets.youtube.status,'Submission failed');
 delete records.get(path).value.targets.youtube.submissions['https://contentrewards.com/c/campaigns/test'].error;
 const finalClaim=await action({rewardAccountId:'test-account',step:'claim'});
 assert.equal((await action({step:'confirm',attempt:finalClaim.data.attempt})).data.targets.youtube.status,'Delivered');
 assert.equal((await action({rewardAccountId:'test-account',step:'claim'})).code,409);
 assert.equal((await action({step:'fail',error:reason})).data.targets.youtube.status,'Delivered');
});

test('new videos select one campaign while legacy multi-campaign jobs retain their state',async()=>{
 const admin=process.env.ADMIN_TOKEN;
 const urls=['music','clips','events'].map(id=>'https://contentrewards.com/c/campaigns/'+id);
 const channel='variety';
 const created=await call('channels',admin,{slug:channel,name:'Variety',rewardAccountId:'test-account',youtube:'refresh',campaignUrls:[...urls,urls[0]+'/']});
 assert.deepEqual(created.data.campaignUrls,urls);
 records.get('channels/'+channel).value.youtubeChannelId='UCvariety';
 const id=randomUUID();
 const payload={channel,title:'Selected clip'};
 assert.equal((await call('videos',admin,payload,id)).code,400);
 const selected=urls.slice(0,2);
 assert.equal((await call('videos',admin,{...payload,campaignUrls:selected},id)).code,400);
 const upload={...payload,campaignUrl:urls[0]};
 assert.equal((await call('videos',admin,{...upload,campaignUrls:[urls[0]]},id)).code,400);
 assert.equal((await call('videos',admin,upload,id)).code,200);
 await call('channels/'+channel,admin,{campaignUrls:[urls[2]]});
 assert.equal((await call('videos',admin,upload,id)).code,200);
 assert.equal((await call('videos',admin,{...upload,campaignUrl:urls[2]},id)).code,409);
 assert.equal((await call('videos/'+id,admin)).data.campaignUrl,urls[0]);
 // Existing multi-campaign records remain readable and resumable.
 records.get('jobs/'+id).value.campaignUrls=selected;
 const dest=records.get('jobs/'+id).value.targets.youtube;
 Object.assign(dest,{done:true,url:'https://www.youtube.com/watch?v=clip'});
 const submit=body=>call('videos/'+id+'/submission/youtube',admin,body);
 assert.equal((await submit({rewardAccountId:'test-account',step:'claim'})).code,400);
 assert.equal((await submit({rewardAccountId:'test-account',step:'claim',campaignUrl:urls[2]})).code,400);
 const claimA=await submit({rewardAccountId:'test-account',step:'claim',campaignUrl:urls[0]});
 const claimB=await submit({rewardAccountId:'test-account',step:'claim',campaignUrl:urls[1]});
 assert.equal((await submit({step:'confirm',campaignUrl:urls[1],attempt:claimA.data.attempt})).code,409);
 const partial=await submit({step:'confirm',campaignUrl:urls[1],attempt:claimB.data.attempt});
 assert.deepEqual(partial.data.targets.youtube.submissions.map(s=>s.status),['Check submission','Delivered']);
 assert.equal((await submit({rewardAccountId:'test-account',step:'claim',campaignUrl:urls[1]})).code,409);
 const result=await submit({step:'resolve',campaignUrl:urls[0],outcome:'received'});
 assert.equal(result.data.targets.youtube.status,'Delivered');
});

test('YouTube OAuth binds browser and channel, consumes state and hides credentials',async t=>{
 process.env.APP_URL='http://127.0.0.1:3000';
 process.env.GOOGLE_CLIENT_ID='client';
 process.env.GOOGLE_CLIENT_SECRET='secret';
 const {startYouTube,finishYouTube}=await import('../lib/youtube-oauth.js');
 const admin=process.env.ADMIN_TOKEN;
 await call('channels',admin,{slug:'oauth-channel',name:'OAuth channel'});
 const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(){this.writableEnded=true;}});
 const start=response();
 const {url}=await startYouTube('oauth-channel',start);
 const auth=new URL(url);
 assert.equal(auth.origin,'https://accounts.google.com');
 assert.equal(auth.searchParams.get('access_type'),'offline');
 assert.equal(auth.searchParams.get('redirect_uri'),process.env.APP_URL+'/api/v1/oauth/youtube/callback');
 const state=auth.searchParams.get('state');
 const callback=new URL(process.env.APP_URL+'/api/v1/oauth/youtube/callback?state='+state+'&code=code');
 const wrong=response();
 await finishYouTube({headers:{}},wrong,callback);
 assert.match(wrong.headers.Location,/error=/);
 assert.equal(records.get('oauth/'+state).value.used,undefined);
 let exchanges=0;
 t.mock.method(globalThis,'fetch',async(address,options)=>{
  if(address.includes('/token')){
   exchanges++;
   assert.ok(options.body.get('code_verifier'));
   return Response.json({access_token:'access',refresh_token:'private-refresh',scope:auth.searchParams.get('scope')});
  }
  return Response.json({items:[{id:'UC123',snippet:{title:'My YouTube'}}]});
 });
 const browser={headers:{cookie:start.headers['Set-Cookie'].split(';')[0]}};
 const result=response();
 await finishYouTube(browser,result,callback);
 assert.match(result.headers.Location,/result=connected/);
 const channel=records.get('channels/oauth-channel').value;
 assert.equal(channel.youtube,'private-refresh');
 assert.equal(channel.youtubeChannelId,'UC123');
 const overview=await call('overview',admin);
 assert.equal(overview.data.channels.find(c=>c.slug==='oauth-channel').youtubeTitle,'My YouTube');
 assert.ok(!JSON.stringify(overview.data).includes('private-refresh'));
 await finishYouTube(browser,response(),callback);
 assert.equal(exchanges,1);
 const again=response();
 const next=await startYouTube('oauth-channel',again);
 const nextState=new URL(next.url).searchParams.get('state');
 records.get('oauth/'+nextState).value.expires=0;
 const expired=response();
 await finishYouTube({headers:{cookie:again.headers['Set-Cookie'].split(';')[0]}},expired,new URL(process.env.APP_URL+'/api/v1/oauth/youtube/callback?state='+nextState+'&code=code'));
 assert.match(expired.headers.Location,/error=/);
 assert.equal(exchanges,1);
});

test('Instagram OAuth dialog URL matches config and finishes with linked account credentials',async t=>{
 const {startInstagram,finishInstagram}=await import('../lib/instagram-oauth.js');
 process.env.META_CLIENT_SECRET='test-meta-secret';
 const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(){this.writableEnded=true;}});
 const start=response();
 const {url}=await startInstagram('oauth-channel',start);
 const auth=new URL(url);
 assert.equal(auth.origin,'https://www.facebook.com');
 assert.equal(auth.pathname,'/dialog/oauth');
 assert.equal(auth.searchParams.get('client_id'),'2290127438585993');
 assert.equal(auth.searchParams.get('config_id'),'1550515130504470');
 assert.equal(auth.searchParams.get('display'),'popup');
 assert.equal(auth.searchParams.get('override_default_response_type'),'true');
 assert.equal(auth.searchParams.get('prompt'),'login');
 assert.equal(auth.searchParams.get('response_type'),'code');
 assert.equal(auth.searchParams.get('redirect_uri'),process.env.APP_URL+'/api/v1/oauth/instagram/callback');
 const state=auth.searchParams.get('state');
 const callback=new URL(process.env.APP_URL+'/api/v1/oauth/instagram/callback?state='+state+'&code=meta_auth_code');

 t.mock.method(globalThis,'fetch',async(address)=>{
  if(address.toString().includes('/oauth/access_token')){
   return Response.json({access_token:'meta-user-access-token'});
  }
  if(address.toString().includes('/me/accounts')){
   return Response.json({
    data:[{
     id:'page123',
     access_token:'meta-page-access-token',
     instagram_business_account:{id:'178414999999999',username:'my_ig_creator'}
    }]
   });
  }
  return Response.json({});
 });

 const browser={headers:{cookie:start.headers['Set-Cookie'].split(';')[0]}};
 const result=response();
 await finishInstagram(browser,result,callback);
 assert.match(result.headers.Location,/result=connected/);
 assert.match(result.headers.Location,/platform=instagram/);

 const channel=records.get('channels/oauth-channel').value;
 assert.equal(channel.instagram,'meta-page-access-token');
 assert.equal(channel.instagramId,'178414999999999');
 assert.equal(channel.instagramTitle,'@my_ig_creator');
});

test('dashboard cookie survives refresh and OAuth return, and logout revokes it',async()=>{
 const request=async(path,method='GET',body,headers={})=>{
  const req={url:'/api/v1/'+path,method,body,headers};
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.data=v;}};
  await handler(req,res);
  return res;
 };
 const header={'x-cliprelay-request':'1','x-forwarded-proto':'https'};
 assert.equal((await request('auth/login','POST',{token:'wrong'},header)).code,401);
 assert.equal((await request('auth/login','POST',{token:process.env.ADMIN_TOKEN})).code,403);
 const logged=await request('auth/login','POST',{token:process.env.ADMIN_TOKEN},header);
 assert.equal(logged.code,200);
 assert.match(logged.headers['Set-Cookie'],/HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/);
 const cookie=logged.headers['Set-Cookie'].split(';')[0];
 const authHeaders={...header,cookie};
 assert.equal((await request('auth/session','GET',undefined,{cookie})).data.authenticated,true);
 assert.equal((await request('overview','GET',undefined,{cookie})).code,200);
 assert.equal((await request('channels','POST',{slug:'csrf',name:'Blocked'},{cookie})).code,403);
 assert.equal((await request('auth/logout','POST',{},authHeaders)).code,200);
 assert.equal((await request('auth/session','GET',undefined,{cookie})).data.authenticated,false);
 assert.equal((await request('overview','GET',undefined,{cookie})).code,401);
 const next=await request('auth/login','POST',{token:process.env.ADMIN_TOKEN},header);
 const nextCookie=next.headers['Set-Cookie'].split(';')[0];
 const admin=process.env.ADMIN_TOKEN;
 process.env.ADMIN_TOKEN='rotated-admin-token';
 assert.equal((await request('auth/session','GET',undefined,{cookie:nextCookie})).data.authenticated,false);
 process.env.ADMIN_TOKEN=admin;
 const {createHash}=await import('node:crypto');
 const id=createHash('sha256').update(nextCookie.split('=')[1]).digest('hex');
 records.get('sessions/'+id).value.expires=Date.now()-1;
 assert.equal((await request('auth/session','GET',undefined,{cookie:nextCookie})).data.authenticated,false);
});

 test('reward account ownership prevents duplicate YouTube reassignment and mismatched workers',async()=>{
 const admin=process.env.ADMIN_TOKEN;
 for(const id of ['owner-a','owner-b'])assert.equal((await call('reward-accounts',admin,{id,name:id})).code,200);
 assert.equal((await call('channels',admin,{slug:'owner-first',name:'First',rewardAccountId:'owner-a'})).code,200);
 records.get('channels/owner-first').value.youtubeChannelId='UCshared';
 assert.equal((await call('channels/owner-first',admin,{name:'First'})).code,200);
 assert.equal((await call('channels/owner-first',admin,{rewardAccountId:'owner-b'})).code,409);
 await call('channels',admin,{slug:'owner-copy',name:'Copy'});
 records.get('channels/owner-copy').value.youtubeChannelId='UCshared';
 assert.equal((await call('channels/owner-copy',admin,{rewardAccountId:'owner-b'})).code,409);
 assert.equal((await call('channels/owner-copy',admin,{rewardAccountId:'owner-a'})).code,200);
 const {bindYouTube}=await import('../lib/reward-accounts.js');
 const race=await Promise.allSettled([bindYouTube('UCrace','owner-a'),bindYouTube('UCrace','owner-b')]);
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(race.find(r=>r.status==='rejected').reason.status,409);
 const id=randomUUID();
 records.set('jobs/'+id,{tag:'new',value:{id,channel:'owner-first',created:new Date().toISOString(),rewardAccountId:'owner-a',rewardPlatform:'contentrewards',campaignUrls:['https://contentrewards.com/c/campaigns/test'],targets:{youtube:{done:true,url:'https://youtube.com/watch?v=clip'}}}});
 assert.equal((await call('videos/'+id+'/submission/youtube',admin,{step:'claim',rewardAccountId:'owner-b'})).code,409);
 assert.equal((await call('videos/'+id+'/submission/youtube',admin,{step:'claim',rewardAccountId:'owner-a'})).code,200);
 });

test('signed workers are account-scoped and lease protected',async()=>{
 const admin=process.env.ADMIN_TOKEN;
 process.env.HOME_WORKER_SECRET='s'.repeat(64);
 process.env.CLIPRELAY_SECRET='c'.repeat(64);
 const key={account:'owner-a'};
 const instance=randomUUID();
 const timestamp=String(Date.now());
 const payload=workerPayload('POST','/api/v1/worker/heartbeat','owner-a',instance,JSON.stringify({instance,state:'idle'}));
 assert.equal((await call('worker/heartbeat',key,{instance,state:'idle'},undefined,{'x-cliprelay-timestamp':timestamp,'x-cliprelay-signature':webhookSignature(process.env.HOME_WORKER_SECRET,timestamp,payload)})).code,401,'Inbound webhook secret cannot authenticate callbacks');
 assert.equal((await call('worker/heartbeat',key,{instance,state:'idle'})).code,200);
 assert.equal((await call('overview',admin)).data.rewardAccounts.find(a=>a.id==='owner-a').worker.hasBrowserProfile,null);
 assert.equal((await call('worker/heartbeat',key,{instance,state:'idle',hasBrowserProfile:false})).code,200);
 assert.equal((await call('overview',admin)).data.rewardAccounts.find(a=>a.id==='owner-a').worker.hasBrowserProfile,false);
 assert.equal((await call('worker/heartbeat',key,{instance,state:'idle',hasBrowserProfile:true})).code,200);
 assert.equal((await call('worker/heartbeat',key,{instance:randomUUID()})).code,409);
 assert.equal((await call('overview',key)).code,403);
 assert.equal((await call('videos',key,{channel:'owner-first'})).code,403);
 const overview=(await call('overview',admin)).data;
 assert.equal(overview.rewardAccounts.find(a=>a.id==='owner-a').worker.online,true);
 assert.equal(overview.rewardAccounts.find(a=>a.id==='owner-a').worker.hasBrowserProfile,true);


 const id=randomUUID();
 records.set('jobs/'+id,{tag:'worker-test',value:{id,channel:'owner-first',rewardAccountId:'owner-a',rewardPlatform:'contentrewards',created:new Date().toISOString(),campaignUrls:['https://contentrewards.com/c/campaigns/test'],targets:{youtube:{done:true,url:'https://youtube.com/watch?v=test'}}}});
 assert.equal((await call('videos/'+id+'/publish/youtube',key,{})).code,403);
 const claimBody={step:'claim',rewardAccountId:'owner-a'};
 assert.equal((await call('videos/'+id+'/submission/youtube',key,claimBody)).code,409);
 assert.equal((await call('videos/'+id+'/submission/youtube',key,claimBody,undefined,{'x-worker-instance':instance})).code,200);
 assert.equal((await call('videos/'+id+'/submission/youtube',key,{step:'fail',error:'Campaign rejected the link'})).code,409);
 const failed=await call('videos/'+id+'/submission/youtube',key,{step:'fail',error:'Campaign rejected the link'},undefined,{'x-worker-instance':instance});
 assert.equal(failed.code,200);
 assert.equal(failed.data.targets.youtube.submissions[0].error,'Campaign rejected the link');
 assert.equal((await call('videos/'+id+'/submission/youtube',{account:'owner-b'},{step:'fail',error:'Wrong account'})).code,403);
 assert.equal((await call('videos/'+id,{account:'owner-b'})).code,403);
 assert.equal((await call('worker/heartbeat',key,{instance},undefined,{'x-cliprelay-signature':'0'.repeat(64)})).code,401);
 assert.equal((await call('worker/heartbeat',key,{instance},undefined,{'x-cliprelay-timestamp':'1000000000000'})).code,401);
 assert.equal((await call('worker/stop',key,{instance})).code,200);
 assert.equal((await call('overview',admin)).data.rewardAccounts.find(a=>a.id==='owner-a').worker.online,false);
});

test('published targets dispatch links to the home webhook and allow retry after offline failure',async t=>{
 const admin=process.env.ADMIN_TOKEN,id=randomUUID();
 const url='https://www.youtube.com/watch?v=home-test';
 records.set('jobs/'+id,{tag:'dispatch-test',value:{id,channel:'owner-first',rewardAccountId:'owner-a',rewardPlatform:'contentrewards',created:new Date().toISOString(),campaignUrls:['https://contentrewards.com/c/campaigns/test'],targets:{youtube:{done:true,url}}}});
 process.env.HOME_WORKER_URL='https://home.example/home-worker/webhook';process.env.HOME_WORKER_SECRET='h'.repeat(64);
 let online=false,calls=0;
 t.mock.method(globalThis,'fetch',async(endpoint,options)=>{
   calls++;assert.equal(endpoint.href,process.env.HOME_WORKER_URL);
   assert.equal(JSON.parse(options.body).url,url);
   if(!online)throw Error('offline');
   return {ok:true,json:async()=>({accepted:true,jobId:id})};
 });
 try{
  const first=await call('videos/'+id+'/publish/youtube',admin,{});
  assert.equal(first.code,200);assert.equal(first.data.targets.youtube.homeDelivery.accepted,false);
  online=true;
  const retry=await call('videos/'+id+'/dispatch/youtube',admin,{});
  assert.equal(retry.data.targets.youtube.homeDelivery.accepted,true);
  await call('videos/'+id+'/publish/youtube',admin,{});
  assert.equal(calls,2,'Acknowledged delivery is not sent again by a publish retry');
 }finally{delete process.env.HOME_WORKER_URL;delete process.env.HOME_WORKER_SECRET;}
});


test('video and thumbnail uploads retain a database log and verify both R2 objects',async()=>{
 const admin=process.env.ADMIN_TOKEN;
 await call('channels',admin,{slug:'upload-test',name:'Upload Test',instagram:'token',instagramId:'123',rewardAccountId:'test-account',campaigns:[{name:'Summer Campaign',url:'https://contentrewards.com/c/campaigns/summer'}]});
 const key=(await call('channels/upload-test/key',admin,{})).data.key;
 const id=randomUUID(),payload={channel:'upload-test',title:'Clip',hookText:'Watch this moment',description:'A description of the clip.',instagramDescription:'Instagram caption',youtubeDescription:'YouTube description',campaignName:'Summer Campaign',videoFileName:'clip.mp4',thumbnailFileName:'cover.jpg',platforms:['instagram']};
 const created=await call('videos',key,payload,id);
 assert.equal(created.code,200);
 const job=created.data;
 assert.notEqual(job.uploadId,id);
 assert.equal(job.objectKey,'upload-test/Summer Campaign/clip.mp4');
 assert.equal(job.thumbnail.objectKey,'upload-test/Summer Campaign/cover.jpg');
 assert.equal(job.thumbnail.headers['Content-Type'],'image/jpeg');
 assert.equal(job.hookText,payload.hookText);
 assert.equal((await call('videos/'+id,key)).data.description,payload.description);
 assert.equal((await call('videos',key,{...payload,hookText:'Changed'},id)).code,409);
 assert.equal((await call('videos',key,{...payload,description:'Changed'},id)).code,409);
 assert.equal((await call('videos',key,{...payload,hookText:123},randomUUID())).code,400);
 assert.equal((await call('videos',key,payload,id)).data.uploadId,job.uploadId);
 assert.equal((await call('videos',key,{...payload,thumbnailFileName:'different.jpg'},id)).code,409);
 assert.equal((await call('videos',key,payload,randomUUID())).code,409);
 assert.equal((await call('videos',key,{...payload,videoFileName:'../clip.mp4'},randomUUID())).code,400);
 assert.equal((await call('videos',key,{...payload,thumbnailFileName:'cover.png'},randomUUID())).code,400);
 objects.set(job.objectKey,null);objects.set(job.thumbnail.objectKey,null);
 const complete=()=>call('videos/'+id+'/upload-complete',key,{});
 assert.equal((await complete()).data.status,'pending');
 objects.set(job.objectKey,{bytes:123,contentType:'video/mp4'});
 assert.equal((await complete()).data.status,'partial');
 assert.equal((await call('videos/'+id+'/publish/instagram',key,{})).code,409);
 objects.set(job.thumbnail.objectKey,{bytes:12,contentType:'text/plain'});
 assert.equal((await complete()).data.status,'invalid');
 objects.set(job.thumbnail.objectKey,{bytes:12,contentType:'image/jpeg'});
 assert.equal((await complete()).data.status,'uploaded');
 const log=(await call('uploads/'+job.uploadId,key)).data;
 assert.equal(log.status,'uploaded');assert.equal(log.assets.thumbnail.bytes,12);
 assert.equal(log.instagramDescription,payload.instagramDescription);assert.equal(log.youtubeDescription,payload.youtubeDescription);
 assert.equal((await call('videos',key,{...payload,instagramDescription:'changed'},id)).code,409);
 assert.equal((await call('videos',key,{...payload,youtubeDescription:'changed'},id)).code,409);
 assert.equal((await call('videos',key,{...payload,instagramDescription:'x'.repeat(2201)},randomUUID())).code,400);
 assert.equal(log.hookText,payload.hookText);assert.equal(log.description,payload.description);
 assert.equal((await call('videos/'+id+'/upload-log',key)).data.id,job.uploadId);
 await call('channels',admin,{slug:'upload-other',name:'Other',instagram:'token',instagramId:'456'});
 const other=(await call('channels/upload-other/key',admin,{})).data.key;
 assert.equal((await call('uploads/'+job.uploadId,other)).code,403);
 assert.equal((await call('videos/'+id+'/upload-complete',other,{})).code,403);
});


test('publishing uses each platform description and preserves caption fallback',async t=>{
 const {advance}=await import('../lib/publish.js');
 let youtubeText,instagramText;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(String(url).includes('oauth2'))return Response.json({access_token:'test'});
  if(String(url).includes('uploadType')){youtubeText=JSON.parse(options.body).snippet.description;return new Response(null,{headers:{location:'https://upload.example/session'}});}
  if(String(url).includes('upload.example'))return Response.json({id:'published'});
  if(String(url).includes('video.mp4'))return new Response(Buffer.alloc(3),{status:206});
  if(String(url).endsWith('/media')){instagramText=options.body.get('caption');return Response.json({id:'container'});}
  throw Error('Unexpected request');
 });
 const channel={youtube:'token',instagram:'token',instagramId:'123'};
 for(const overrides of [{youtubeDescription:'YouTube text',instagramDescription:'Instagram text'},{}]){
  const job={title:'Title',caption:'Fallback',key:'video.mp4',bytes:3,...overrides};
  await advance('youtube',channel,job,{},async()=>{});
  await advance('instagram',channel,job,{},async()=>{});
  assert.equal(youtubeText,overrides.youtubeDescription || 'Fallback');
  assert.equal(instagramText,overrides.instagramDescription || 'Fallback');
 }
});


test('campaign names resolve one URL and retain the original mapping on retry',async()=>{
 const admin=process.env.ADMIN_TOKEN,channel='named-campaigns';
 const first={name:'Summer Launch',url:'https://contentrewards.com/c/campaigns/summer'};
 const second={name:'Winter Launch',url:'https://contentrewards.com/c/campaigns/winter'};
 const created=await call('channels',admin,{slug:channel,name:'Named',instagram:'token',instagramId:'123',rewardAccountId:'test-account',campaigns:[first,second]});
 assert.equal(created.code,200);assert.deepEqual(created.data.campaigns,[first,second]);
 const payload={channel,title:'Named clip',campaignName:'summer launch'};
 const id=randomUUID(),job=await call('videos',admin,payload,id);
 assert.equal(job.code,200);assert.equal(job.data.campaignUrl,first.url);
 assert.equal(job.data.campaignName,first.name);
 assert.equal(job.data.objectKey,channel+'/Summer Launch/'+id+'.mp4');
 assert.equal((await call('videos',admin,{...payload,campaignName:'Unknown'},randomUUID())).code,400);
 assert.equal((await call('videos',admin,{...payload,campaignUrl:second.url},randomUUID())).code,400);
 assert.equal((await call('videos',admin,{...payload,campaignName:'Winter Launch'},id)).code,409);
 assert.equal((await call('channels/'+channel,admin,{campaigns:[first,{...second,name:'SUMMER LAUNCH'}]})).code,400);
 assert.equal((await call('channels/'+channel,admin,{campaigns:[first,{...second,url:first.url}]})).code,400);
 assert.equal((await call('channels/'+channel,admin,{campaigns:[{...first,name:'../bad'}]})).code,400);
 await call('channels/'+channel,admin,{campaigns:[{...first,url:'https://contentrewards.com/c/campaigns/replaced'},second]});
 assert.equal((await call('videos',admin,payload,id)).data.campaignUrl,first.url);
 assert.equal((await call('videos',admin,payload,randomUUID())).data.campaignUrl,'https://contentrewards.com/c/campaigns/replaced');
});

test('targetView sets Uploaded only upon API confirmation and never on error',async()=>{
 const admin=process.env.ADMIN_TOKEN;
 const channel='tv-status-test';
 await call('channels',admin,{slug:channel,name:'Status Channel'});
 const id=randomUUID();
 records.set('jobs/'+id,{tag:'tv1',value:{id,channel,created:new Date().toISOString(),bytes:100,targets:{youtube:{videoId:'v123',uploadedBytes:100}}}});
 const res1=await call('videos/'+id,admin);
 assert.equal(res1.data.targets.youtube.status,'Processing on YouTube');
 assert.equal(res1.data.targets.youtube.uploadConfirmed,false);

 records.get('jobs/'+id).value.targets.youtube.uploadConfirmed=true;
 records.get('jobs/'+id).value.targets.youtube.uploadStatus='uploaded';
 const res2=await call('videos/'+id,admin);
 assert.equal(res2.data.targets.youtube.status,'Uploaded');
 assert.equal(res2.data.targets.youtube.uploadConfirmed,true);

 records.get('jobs/'+id).value.targets.youtube.error='Failed to process';
 const res3=await call('videos/'+id,admin);
 assert.equal(res3.data.targets.youtube.status,'Needs attention');
 assert.notEqual(res3.data.targets.youtube.status,'Uploaded');
});

test('cron scheduler selects 1 video per campaign FIFO, and cron publisher executes and dispatches it',async t=>{
 const admin=process.env.ADMIN_TOKEN;
 const channel='cron-test-channel';
 await call('channels',admin,{slug:channel,name:'Cron Test Channel',youtube:'connected'});

 const now=Date.now();
 const id1=randomUUID();
 const id2=randomUUID();

 // Job 1 uploaded earlier (older) - waiting to be published
 records.set('jobs/'+id1,{tag:'t1',value:{id:id1,channel,campaignName:'summer-campaign',created:new Date(now-7200000).toISOString(),bytes:100,targets:{youtube:{}}}});
 // Job 2 uploaded later (newer)
 records.set('jobs/'+id2,{tag:'t2',value:{id:id2,channel,campaignName:'summer-campaign',created:new Date(now-3600000).toISOString(),bytes:100,targets:{youtube:{}}}});

 // 1. Run cron/schedule
 const schedRes1=await call('cron/schedule',admin);
 assert.equal(schedRes1.code,200);
 const summerScheduled=schedRes1.data.scheduled.filter(s=>s.campaign==='summer-campaign');
 assert.equal(summerScheduled.length,1);
 assert.equal(summerScheduled[0].id,id1); // Oldest chosen (FIFO)

 // Check targetView reflects Scheduled status
 const job1Check=await call('videos/'+id1,admin);
 assert.equal(job1Check.data.targets.youtube.status,'Scheduled');

 // 2. Second run on same day must schedule 0 videos for this campaign (daily quota: 1 per campaign)
 const schedRes2=await call('cron/schedule',admin);
 assert.equal(schedRes2.code,200);
 const summerScheduled2=schedRes2.data.scheduled.filter(s=>s.campaign==='summer-campaign');
 assert.equal(summerScheduled2.length,0);

 // 3. Make scheduledAt due now and simulate uploaded videoId to trigger cron/publish
 records.get('jobs/'+id1).value.scheduledAt=new Date(now-1000).toISOString();
 records.get('jobs/'+id1).value.targets.youtube.videoId='v123';

 const pubRes=await call('cron/publish',admin);
 assert.equal(pubRes.code,200);
 assert.ok(pubRes.data.published.some(p=>p.id===id1));

 // Check that job 1 now has publishedAt and status is finished
 const job1Done=await call('videos/'+id1,admin);
 assert.equal(job1Done.data.targets.youtube.status,'Published');
 assert.ok(job1Done.data.targets.youtube.publishedAt);

 // 4. Running cron/schedule again finds no pending jobs for summer-campaign today
 const schedRes3=await call('cron/schedule',admin);
 assert.equal(schedRes3.data.scheduled.filter(s=>s.campaign==='summer-campaign').length,0);
});
