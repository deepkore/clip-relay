import {Readable} from 'node:stream';
import {youtubeClient} from './google-client.js';
import {inspectShorts} from './shorts.js';
import {downloadURL,fail} from './storage.js';

const options={timeout:20000,retry:false,maxRedirects:0};
const header=(response,name)=>response.headers?.get?.(name) ?? response.headers?.[name];

export async function publishYouTube(channel,job,dest,checkpoint){
  if(dest.url && !dest.videoId)return true; // Previously completed jobs.
  if(!dest.shorts){dest.shorts=await inspectShorts(job);await checkpoint();}
  const {auth,youtube}=youtubeClient(channel);
  try{
    if(dest.videoId){
      const {data}=await youtube.videos.list({part:['status','processingDetails'],id:[dest.videoId]},options);
      const video=data.items?.[0];
      if(!video)throw fail(502,'YouTube has not returned this uploaded video yet. Retry shortly.');
      dest.processingStatus=video.processingDetails?.processingStatus || video.status?.uploadStatus;
      dest.uploadStatus=video.status?.uploadStatus;
      if(['uploaded','processed'].includes(video.status?.uploadStatus))dest.uploadConfirmed=true;
      if(['failed','terminated'].includes(dest.processingStatus) || ['failed','rejected','deleted'].includes(video.status?.uploadStatus))throw fail(422,'YouTube rejected or failed to process the video: '+(video.status?.rejectionReason || video.status?.failureReason || video.processingDetails?.processingFailureReason || dest.processingStatus));
      await checkpoint();
      if(video.status?.uploadStatus!=='processed')return false;
      if(video.status.privacyStatus!=='public')throw fail(409,'The uploaded video is not public on YouTube. Check its visibility and API project restrictions in YouTube Studio, then Continue.');
      const thumbnailKey=job.thumbnailKey || job.thumbnail_key;
      if(thumbnailKey && !dest.thumbnail && youtube.thumbnails?.set){
        const thumbUrl=await downloadURL(thumbnailKey);
        const thumbRes=await fetch(thumbUrl,{signal:AbortSignal.timeout(20000)});
        if(thumbRes.ok){
          const thumbBuf=Buffer.from(await thumbRes.arrayBuffer());
          const mimeType=thumbnailKey.endsWith('.png')?'image/png':'image/jpeg';
          try{
            await youtube.thumbnails.set({
              videoId:dest.videoId,
              media:{mimeType,body:Readable.from(thumbBuf)}
            },options);
            dest.thumbnail=true;
            delete dest.thumbnailWarning;
            await checkpoint();
          }catch(err){
            dest.thumbnail=false;
            const message=err.response?.data?.error?.message || err.message || '';
            const isVerification=err.response?.status===403 || /permission|verify|verification|forbidden/i.test(message);
            if(isVerification){
              throw fail(403,'YouTube channel verification required to upload custom thumbnails. Verify your channel in YouTube Studio, then Retry publishing.');
            }
            throw fail(err.status || 502,'Failed to upload thumbnail: '+message);
          }
        }
      }
      dest.url='https://www.youtube.com/shorts/'+encodeURIComponent(dest.videoId);
      delete dest.error;
      return true;
    }
    if(!dest.session){
      // The Node client does not persist resumable sessions itself. Start one via
      // videos.insert and keep its URL in the existing encrypted checkpoint.
      const res=await youtube.videos.insert({part:['snippet','status'],uploadType:'resumable',requestBody:{snippet:{title:job.title,description:job.youtubeDescription || job.caption},status:{privacyStatus:'public'}}},{...options,url:'https://www.googleapis.com/upload/youtube/v3/videos',headers:{'X-Upload-Content-Type':'video/mp4','X-Upload-Content-Length':String(job.bytes)}});
      dest.session=header(res,'location');
      if(!dest.session)throw fail(502,'YouTube did not return an upload session.');
      dest.uploadedBytes=0;
      await checkpoint();
    }
    const put=(headers,data)=>auth.request({...options,url:dest.session,method:'PUT',headers,data,validateStatus:status=>status===308 || status>=200 && status<300});
    const finish=res=>{
      if(res.status===308){
        const range=header(res,'range');
        const match=/^bytes=0-(\d+)$/.exec(range || '');
        if(range && !match)throw fail(502,'YouTube returned an invalid upload range.');
        dest.uploadedBytes=match?Number(match[1])+1:0;
        return false;
      }
      if(!res.data?.id)throw fail(502,'YouTube returned an incomplete video record.');
      dest.videoId=res.data.id;dest.uploadedBytes=job.bytes;dest.processingStatus='processing';
      if(res.data.status?.uploadStatus){
        dest.uploadStatus=res.data.status.uploadStatus;
        if(['uploaded','processed'].includes(res.data.status.uploadStatus))dest.uploadConfirmed=true;
      }
      delete dest.session;
      return true;
    };
    if(!finish(await put({'Content-Range':'bytes */'+job.bytes,'Content-Length':'0'}))){
      while(!dest.videoId){
        const start=dest.uploadedBytes || 0;
        if(!Number.isSafeInteger(start) || start<0 || start>job.bytes)throw fail(502,'YouTube returned an invalid uploaded byte count.');
        if(start===job.bytes)break;
        const end=Math.min(start+8*1024*1024,job.bytes)-1;
        const piece=await fetch(await downloadURL(job.key),{headers:{Range:'bytes='+start+'-'+end},signal:AbortSignal.timeout(30000)});
        if(piece.status!==206)throw fail(502,'R2 did not return the requested video range.');
        const data=Buffer.from(await piece.arrayBuffer());
        if(data.length!==end-start+1)throw fail(502,'R2 returned an incomplete video chunk.');
        finish(await put({'Content-Type':'video/mp4','Content-Length':String(data.length),'Content-Range':'bytes '+start+'-'+end+'/'+job.bytes},data));
        await checkpoint();
      }
    }
    if(dest.videoId){
      const {data}=await youtube.videos.list({part:['status','processingDetails'],id:[dest.videoId]},options);
      const video=data.items?.[0];
      if(video){
        dest.processingStatus=video.processingDetails?.processingStatus || video.status?.uploadStatus;
        dest.uploadStatus=video.status?.uploadStatus;
        if(['uploaded','processed'].includes(video.status?.uploadStatus))dest.uploadConfirmed=true;
        await checkpoint();
      }
    }
    return false;
  }catch(error){
    if(error.status && !error.response)throw error;
    const code=error.response?.status;
    const reason=error.response?.data?.error?.errors?.[0]?.reason;
    if([404,410].includes(code) && dest.session)throw fail(409,'YouTube upload session expired. Check YouTube Studio before creating a replacement upload.');
    throw fail(502,'YouTube client request failed'+(code?' (HTTP '+code+')':'')+(reason?' ['+String(reason).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)+']':'')+'. Continue to retry the same upload.');
  }
}
