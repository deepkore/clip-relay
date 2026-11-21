import {campaignName as validateCampaignName} from './campaigns.js';
import {fail,objectInfo,updateUploadLog} from './storage.js';

export function uploadNames(body){
  if(body.videoFileName===undefined && body.thumbnailFileName===undefined && body.campaignName===undefined)return null;
  const segment=(value,label)=>{
    if(typeof value!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,149}$/.test(value) || value.includes('..') || /[. ]$/.test(value))throw fail(400,'Invalid '+label+'. Use a filename or folder name without slashes.');
    return value;
  };
  const campaignName=validateCampaignName(body.campaignName);
  const videoFileName=body.videoFileName===undefined?undefined:segment(body.videoFileName,'videoFileName');
  if(videoFileName && !/\.mp4$/i.test(videoFileName))throw fail(400,'videoFileName must end in .mp4.');
  const thumbnailFileName=body.thumbnailFileName===undefined?undefined:segment(body.thumbnailFileName,'thumbnailFileName');
  if(thumbnailFileName && !/\.jpg$/i.test(thumbnailFileName))throw fail(400,'thumbnailFileName must end in .jpg.');
  return {campaignName,videoFileName,thumbnailFileName};
}
export async function verifyUploads(job){
  const assets={};
  for(const [name,key,type,max] of [['video',job.key,'video/mp4',1024**3],['thumbnail',job.thumbnailKey,'image/jpeg',10*1024**2]]){
    if(!key)continue;
    const info=await objectInfo(key);
    assets[name]={key,uploaded:!!info,status:!info?'missing':info.contentType!==type || !info.bytes || info.bytes>max?'invalid':'uploaded',bytes:info?.bytes || 0};
  }
  const status=Object.values(assets).every(a=>a.status==='uploaded')?'uploaded':Object.values(assets).some(a=>a.status==='invalid')?'invalid':Object.values(assets).some(a=>a.uploaded)?'partial':'pending';
  await updateUploadLog(job.uploadId,status,assets);
  return {id:job.uploadId,jobId:job.id,status,assets};
}
