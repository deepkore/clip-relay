import * as database from './database.js';
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const fail = (status, message) => Object.assign(new Error(message), {status});
const env = process.env;
export const ready = () => Boolean(env.ADMIN_TOKEN?.length >= 24 && /^[a-f0-9]{64}$/i.test(env.ENCRYPTION_KEY || '') && ['DATABASE_URL','R2_ACCOUNT_ID','R2_BUCKET','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY'].every(k => env[k]?.trim()));
let client;
function s3() {
  return client ||= new S3Client({region:'auto', endpoint:'https://' + env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com', forcePathStyle:true, requestChecksumCalculation:'WHEN_REQUIRED', credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY}});
}
const params = Key => ({Bucket:env.R2_BUCKET, Key});
// Application records are stored only in PostgreSQL.
export const read = name => database.readRecord(name);
export const save = (name,value,tag) => database.saveRecord(name,value,tag);
export const list = prefix => database.listRecords(prefix);
export const createUploadLog = input => database.createUploadLog(input);
export const updateUploadLog = (id,status,assets) => database.updateUploadLog(id,status,assets);
export const readUploadLog = id => database.readUploadLog(id);

export async function uploadURL(key,contentType='video/mp4') {
  return getSignedUrl(s3(),new PutObjectCommand({...params(key),ContentType:contentType,IfNoneMatch:'*'}),{expiresIn:900,signableHeaders:new Set(['content-type','if-none-match'])});
}
export async function objectInfo(key){
  try{const r=await s3().send(new HeadObjectCommand(params(key)));return {bytes:r.ContentLength,contentType:r.ContentType};}
  catch(e){if(e.$metadata?.httpStatusCode===404)return null;throw e;}
}
export const downloadURL = key => getSignedUrl(s3(),new GetObjectCommand(params(key)),{expiresIn:7200});
