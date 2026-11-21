import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { seal, unseal } from './encryption.js';

let pool;
export function databasePool(){
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  pool ||= new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:10000,allowExitOnIdle:true});
  return pool;
}
const sensitiveFields=new Set(['youtube','instagram','webhookToken','verifier','session']);
function transform(value,decrypt=false){
  if(Array.isArray(value)) return value.map(item=>transform(item,decrypt));
  if(!value || typeof value!=='object') return value;
  const result={};
  for(const [key,item] of Object.entries(value)){
    if(decrypt && sensitiveFields.has(key) && item?.encrypted){
      result[key]=unseal(item.encrypted);
    }else if(!decrypt && sensitiveFields.has(key) && typeof item==='string'){
      result[key]={encrypted:seal(item)};
    }else{
      result[key]=transform(item,decrypt);
    }
  }
  return result;
}
const error=(status,message)=>Object.assign(new Error(message),{status});
export const schema=`
CREATE TABLE IF NOT EXISTS cliprelay_records (
  name text PRIMARY KEY,
  kind text NOT NULL,
  data jsonb NOT NULL,
  version uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cliprelay_records_kind ON cliprelay_records(kind);
CREATE TABLE IF NOT EXISTS cliprelay_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  channel text NOT NULL,
  campaign_name text NOT NULL,
  hook_text text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  instagram_description text NOT NULL DEFAULT '',
  youtube_description text NOT NULL DEFAULT '',
  video_key text NOT NULL UNIQUE,
  thumbnail_key text UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  assets jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cliprelay_uploads ADD COLUMN IF NOT EXISTS hook_text text NOT NULL DEFAULT '';
ALTER TABLE cliprelay_uploads ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE cliprelay_uploads ADD COLUMN IF NOT EXISTS instagram_description text NOT NULL DEFAULT '';
ALTER TABLE cliprelay_uploads ADD COLUMN IF NOT EXISTS youtube_description text NOT NULL DEFAULT '';
`;
export async function createUploadLog(input,client=databasePool()){
  const {rows}=await client.query(`INSERT INTO cliprelay_uploads(request_id,channel,campaign_name,video_key,thumbnail_key,hook_text,description,instagram_description,youtube_description)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING *`,[input.requestId,input.channel,input.campaignName,input.videoKey,input.thumbnailKey || null,input.hookText || '',input.description || '',input.instagramDescription || '',input.youtubeDescription || '']);
  const row=rows[0] || (await client.query('SELECT * FROM cliprelay_uploads WHERE request_id=$1',[input.requestId])).rows[0];
  if(!row || row.channel!==input.channel || row.campaign_name!==input.campaignName || row.video_key!==input.videoKey || row.thumbnail_key!==(input.thumbnailKey || null) || row.hook_text!==(input.hookText || '') || row.description!==(input.description || '') || row.instagram_description!==(input.instagramDescription || '') || row.youtube_description!==(input.youtubeDescription || ''))throw error(409,'Upload request or filenames already belong to another video. Use unique filenames.');
  return row.id;
}
export async function updateUploadLog(id,status,assets,client=databasePool()){
  await client.query('UPDATE cliprelay_uploads SET status=$2, assets=$3::jsonb, updated_at=now() WHERE id=$1',[id,status,JSON.stringify(assets)]);
}
export async function readUploadLog(id,client=databasePool()){
  const {rows}=await client.query('SELECT * FROM cliprelay_uploads WHERE id=$1',[id]);
  if(!rows.length)throw error(404,'Upload log not found.');
  const r=rows[0];
  return {id:r.id,jobId:r.request_id,channel:r.channel,campaignName:r.campaign_name,hookText:r.hook_text,description:r.description,instagramDescription:r.instagram_description,youtubeDescription:r.youtube_description,videoKey:r.video_key,thumbnailKey:r.thumbnail_key,status:r.status,assets:r.assets,created:r.created_at,updated:r.updated_at};
}
export async function readRecord(name,client=databasePool()){
  const result=await client.query('SELECT data, version FROM cliprelay_records WHERE name=$1',[name]);
  if(!result.rows.length) throw error(404,'Record not found.');
  return {value:transform(result.rows[0].data,true),tag:result.rows[0].version};
}
export async function saveRecord(name,value,tag,client=databasePool()){
  const version=randomUUID();
  const data=JSON.stringify(transform(value));
  let result;
  if(tag){
    result=await client.query('UPDATE cliprelay_records SET data=$2::jsonb, version=$3, updated_at=now() WHERE name=$1 AND version=$4 RETURNING version',[name,data,version,tag]);
  }else{
    result=await client.query('INSERT INTO cliprelay_records(name,kind,data,version) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(name) DO NOTHING RETURNING version',[name,name.split('/')[0],data,version]);
  }
  if(!result.rows.length) throw error(409,'Record changed. Reload and retry.');
  return result.rows[0].version;
}
export async function listRecords(kind,client=databasePool()){
  const result=await client.query('SELECT data FROM cliprelay_records WHERE kind=$1 ORDER BY name',[kind]);
  return result.rows.map(row=>transform(row.data,true));
}
