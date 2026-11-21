import {createFile} from 'mp4box';
import {downloadURL,fail} from './storage.js';

export function shortsMetadata(info,matrix){
  const tracks=info.videoTracks || info.tracks?.filter(t=>t.video) || [];
  if(tracks.length!==1 || info.isFragmented)throw fail(422,'Shorts require a standard MP4 with one video track. Export a non-fragmented MP4.');
  const track=tracks[0];
  let width=track.track_width || track.video?.width,height=track.track_height || track.video?.height;
  // Rotation in the track transform changes the displayed aspect ratio.
  if(matrix){
    const [a,b,,c,d]=matrix;
    const w=Math.abs(a/65536)*width+Math.abs(c/65536)*height;
    height=Math.abs(b/65536)*width+Math.abs(d/65536)*height;width=w;
  }
  const duration=Math.max(info.duration/info.timescale,track.duration/track.timescale);
  if(!Number.isFinite(duration) || duration<=0 || !Number.isFinite(width) || !Number.isFinite(height) || width<=0 || height<=0)throw fail(422,'Cannot determine the MP4 duration or dimensions. Re-export the video.');
  if(duration>180 || width>height)throw fail(422,'YouTube Shorts require a square or vertical video no longer than 180 seconds. This file is '+Math.round(width)+'×'+Math.round(height)+' and '+duration.toFixed(2)+' seconds.');
  return {width,height,duration,format:'shorts'};
}

export async function inspectShorts(job){
  const file=createFile(false);
  let info,parseError;
  file.onReady=value=>{info=value;};
  file.onError=()=>{parseError=true;};
  const url=await downloadURL(job.key);
  let offset=0,read=0;
  // MP4Box skips media data to locate moov, including files with metadata at the end.
  while(!info && !parseError && offset<job.bytes && read<16*1024*1024){
    const end=Math.min(offset+512*1024,job.bytes)-1;
    const res=await fetch(url,{headers:{Range:'bytes='+offset+'-'+end},signal:AbortSignal.timeout(15000)});
    if(res.status!==206)throw fail(502,'R2 did not return MP4 metadata ranges. Retry publishing.');
    const buffer=await res.arrayBuffer();
    if(buffer.byteLength!==end-offset+1)throw fail(502,'R2 returned an incomplete MP4 metadata range.');
    buffer.fileStart=offset;read+=buffer.byteLength;
    const next=file.appendBuffer(buffer);
    offset=Number.isSafeInteger(next) && next>offset?next:end+1;
  }
  if(!info)throw fail(422,'Could not read the MP4 metadata. Re-export the clip as a standard MP4 with fast-start enabled.');
  const track=(info.videoTracks || info.tracks.filter(t=>t.video))[0];
  return shortsMetadata(info,track?file.getTrackById(track.id)?.tkhd?.matrix:undefined);
}
