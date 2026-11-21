import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { read, save, fail } from './storage.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const cookieName='cliprelay_session';
const duration=30*24*60*60;
const sameSecret=(a,b)=>typeof a==='string' && typeof b==='string' && timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)));
function tokenFrom(req){
  return (req.headers.cookie || '').split(';').map(part=>part.trim()).find(part=>part.startsWith(cookieName+'='))?.slice(cookieName.length+1);
}
function setCookie(req,res,token,maxAge){
  const secure=req.headers['x-forwarded-proto']==='https' || req.socket?.encrypted;
  res.setHeader('Set-Cookie',cookieName+'='+token+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+maxAge+(secure?'; Secure':''));
}
export function checkBrowserRequest(req){
  if(req.headers['x-cliprelay-request']!=='1') throw fail(403,'Reload the dashboard and try again.');
}
export async function sessionFor(req){
  const token=tokenFrom(req);
  if(!/^[a-f0-9]{64}$/.test(token || '')) return null;
  let record;
  const name='sessions/'+hash(token);
  try{record=await read(name);}catch(error){if(error.status===404)return null;throw error;}
  if(record.value.expires<=Date.now() || record.value.revoked || !sameSecret(record.value.adminVersion,hash(process.env.ADMIN_TOKEN)))return null;
  return {...record,name};
}
export async function login(req,res,token){
  checkBrowserRequest(req);
  if(!sameSecret(token,process.env.ADMIN_TOKEN)) throw fail(401,'Invalid workspace admin token.');
  const previous=await sessionFor(req);
  if(previous)await save(previous.name,{...previous.value,revoked:true},previous.tag);
  const sessionToken=randomBytes(32).toString('hex');
  await save('sessions/'+hash(sessionToken),{expires:Date.now()+duration*1000,adminVersion:hash(process.env.ADMIN_TOKEN)});
  setCookie(req,res,sessionToken,duration);
  return {authenticated:true};
}
export async function logout(req,res){
  checkBrowserRequest(req);
  const current=await sessionFor(req);
  if(current)await save(current.name,{...current.value,revoked:true},current.tag);
  setCookie(req,res,'',0);
  return {authenticated:false};
}
