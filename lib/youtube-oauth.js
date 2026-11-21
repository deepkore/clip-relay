import {bindYouTube} from './reward-accounts.js';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { read, save, fail } from './storage.js';

const scopes=['https://www.googleapis.com/auth/youtube.upload','https://www.googleapis.com/auth/youtube.readonly'];
const digest=value=>createHash('sha256').update(value).digest();
function config(){
  const origin=new URL(process.env.APP_URL || '');
  if(origin.protocol!=='https:' && !(origin.protocol==='http:' && ['localhost','127.0.0.1'].includes(origin.hostname))) throw fail(503,'APP_URL must use HTTPS or local development HTTP.');
  if(!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw fail(503,'Configure the Google OAuth client in the server environment.');
  return {origin:origin.origin,redirect:origin.origin+'/api/v1/oauth/youtube/callback',secure:origin.protocol==='https:'};
}
function cookie(state,value,secure,maxAge){
  return 'yt_'+state+'='+value+'; Path=/api/v1/oauth/youtube/callback; HttpOnly; SameSite=Lax; Max-Age='+maxAge+(secure?'; Secure':'');
}
export async function startYouTube(slug,res){
  let settings;
  try {settings=config();}catch(e){throw e.status?e:fail(503,'Set APP_URL to this app’s origin in the server environment.');}
  const {value:channel,tag}=await read('channels/'+slug);
  const state=randomBytes(32).toString('hex');
  const browser=randomBytes(32).toString('hex');
  const verifier=randomBytes(32).toString('base64url');
  await save('oauth/'+state,{slug,browserHash:digest(browser).toString('hex'),verifier,expires:Date.now()+600000});
  channel.youtubePending=state;
  await save('channels/'+slug,channel,tag);
  res.setHeader('Set-Cookie',cookie(state,browser,settings.secure,600));
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:settings.redirect,response_type:'code',scope:scopes.join(' '),access_type:'offline',prompt:'consent select_account',state,code_challenge:digest(verifier).toString('base64url'),code_challenge_method:'S256'}).toString();
  return {url:url.toString()};
}
export async function finishYouTube(req,res,url){
  const settings=config();
  try {
    const state=url.searchParams.get('state') || '';
    if(!/^[a-f0-9]{64}$/.test(state)) throw fail(400,'Invalid connection state.');
    const {value:pending,tag}=await read('oauth/'+state);
    const browser=(req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('yt_'+state+'='))?.split('=')[1];
    if(!browser || pending.used || pending.expires<Date.now() || !timingSafeEqual(digest(browser),Buffer.from(pending.browserHash,'hex'))) throw fail(400,'Connection expired. Start again from the channel.');
    await save('oauth/'+state,{...pending,used:true,verifier:undefined},tag);
    res.setHeader('Set-Cookie',cookie(state,'',settings.secure,0));
    if(url.searchParams.has('error')) throw fail(400,'YouTube connection was cancelled or permission was declined.');
    const code=url.searchParams.get('code');
    if(!code) throw fail(400,'Google did not return an authorization code.');
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({code,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:settings.redirect,grant_type:'authorization_code',code_verifier:pending.verifier}),signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw fail(502,'Google could not complete authorization. Reconnect YouTube.');
    const tokens=await response.json();
    if(!tokens.refresh_token || !scopes.every(scope=>(tokens.scope || '').split(' ').includes(scope))) throw fail(400,'Allow both YouTube permissions to enable publishing and identify your channel.');
    const result=await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',{headers:{Authorization:'Bearer '+tokens.access_token},signal:AbortSignal.timeout(15000)});
    if(!result.ok) throw fail(502,'Unable to retrieve your YouTube channel.');
    const data=await result.json();
    if(data.items?.length!==1) throw fail(400,'Select a Google or Brand account with one YouTube channel and reconnect.');
    const account=data.items[0];
    const {value:channel,tag:channelTag}=await read('channels/'+pending.slug);
    if(channel.youtubePending!==state) throw fail(409,'A newer connection was started. Complete the latest connection.');
    if(channel.youtubeChannelId && channel.youtubeChannelId!==account.id) throw fail(409,'Select the YouTube account already linked to this channel. Create another channel in ClipRelay for a different account.');
    if(channel.rewardAccountId)await bindYouTube(account.id,channel.rewardAccountId);
    channel.youtube=tokens.refresh_token;
    channel.youtubeChannelId=account.id;
    channel.youtubeTitle=account.snippet.title;
    delete channel.youtubePending;
    await save('channels/'+pending.slug,channel,channelTag);
    res.statusCode=303;
    res.setHeader('Location','/oauth-complete.html?result=connected');
    res.end();
  } catch(e){
    const message=e.status?e.message:'YouTube connection failed. Try connecting again.';
    res.statusCode=303;
    res.setHeader('Location','/oauth-complete.html?error='+encodeURIComponent(message));
    res.end();
  }
}
