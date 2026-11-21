import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {OAuth2Client} from 'google-auth-library';
mock.module('../lib/shorts.js',{namedExports:{inspectShorts:async()=>({width:1080,height:1920,duration:30,format:'shorts'})}});
mock.module('../lib/storage.js',{namedExports:{downloadURL:async key=>'https://storage.example/'+key,fail:(status,message)=>Object.assign(Error(message),{status})}});
const {publishYouTube}=await import('../lib/youtube-publish.js');

test('real Google SDK creates one resumable session and waits for public processing',async t=>{
  const requests=[];
  let processed=false;
  t.mock.method(OAuth2Client.prototype,'request',async function(options){
    assert.equal(this.credentials.refresh_token,'refresh-test');
    requests.push(options);
    if(options.method==='POST')return {status:200,headers:new Headers({location:'https://upload.example/session'}),data:{}};
    if(options.method==='PUT')return {status:200,data:{id:'video-test'}};
    return {data:{items:[{status:{uploadStatus:processed?'processed':'uploaded',privacyStatus:'public'},processingDetails:{processingStatus:processed?'succeeded':'processing'}}]}};
  });
  const dest={},job={key:'clip.mp4',bytes:5,title:'A clip',youtubeDescription:'Description'};
  const step=()=>publishYouTube({youtube:'refresh-test'},job,dest,async()=>{});
  assert.equal(await step(),false);
  const insert=requests[0];
  assert.equal(insert.url,'https://www.googleapis.com/upload/youtube/v3/videos');
  assert.equal(insert.params.uploadType,'resumable');
  assert.equal(insert.data.snippet.description,'Description');
  assert.equal(new Headers(insert.headers).get('X-Upload-Content-Length'),'5');
  assert.equal(dest.session,undefined);
  assert.equal(dest.videoId,'video-test');
  assert.equal(dest.url,undefined);
  assert.equal(dest.uploadConfirmed,true);
  assert.equal(dest.uploadStatus,'uploaded');
  processed=true;
  assert.equal(await step(),true);
  assert.equal(dest.uploadStatus,'processed');
  assert.equal(dest.url,'https://www.youtube.com/shorts/video-test');
  assert.equal(requests.filter(r=>r.method==='POST').length,1);
});

test('Google errors preserve resumable session and do not sign the dashboard out',async t=>{
  t.mock.method(OAuth2Client.prototype,'request',async()=>{throw Object.assign(Error('sensitive provider details'),{status:401,response:{status:401}});});
  const dest={session:'https://upload.example/existing',shorts:{format:'shorts'}};
  await assert.rejects(publishYouTube({youtube:'refresh'},{bytes:5},dest,async()=>{}),error=>error.status===502 && !error.message.includes('sensitive'));
  assert.equal(dest.session,'https://upload.example/existing');
});

test('processed private videos are not reported as publicly published',async t=>{
  t.mock.method(OAuth2Client.prototype,'request',async()=>({data:{items:[{status:{uploadStatus:'processed',privacyStatus:'private'}}]}}));
  const dest={videoId:'private-video',shorts:{format:'shorts'}};
  await assert.rejects(publishYouTube({youtube:'refresh'},{},dest,async()=>{}),{status:409});
  assert.equal(dest.url,undefined);assert.equal(dest.videoId,'private-video');
});

test('thumbnailKey uploads and sets custom thumbnail on YouTube when video is processed',async t=>{
  const requests=[];
  t.mock.method(globalThis,'fetch',async url=>{
    assert.equal(url,'https://storage.example/covers/thumb.jpg');
    return new Response(Buffer.from('fake-image-data'),{status:200});
  });
  t.mock.method(OAuth2Client.prototype,'request',async function(options){
    requests.push(options);
    if(options.method==='POST' && String(options.url).includes('thumbnails/set'))return {status:200,data:{items:[{default:{url:'https://yt.example/thumb'}}]}};
    return {data:{items:[{status:{uploadStatus:'processed',privacyStatus:'public'},processingDetails:{processingStatus:'succeeded'}}]}};
  });
  const dest={videoId:'video-thumb',shorts:{format:'shorts'}};
  const job={key:'clip.mp4',bytes:5,title:'A clip',thumbnailKey:'covers/thumb.jpg'};
  const finished=await publishYouTube({youtube:'refresh-test'},job,dest,async()=>{});
  assert.equal(finished,true);
  assert.equal(dest.thumbnail,true);
  assert.equal(dest.url,'https://www.youtube.com/shorts/video-thumb');
  const thumbReq=requests.find(r=>String(r.url).includes('thumbnails/set'));
  assert.ok(thumbReq);
  assert.equal(thumbReq.params.videoId,'video-thumb');
});

test('thumbnailKey supports thumbnail_key alternative property name',async t=>{
  let called=false;
  t.mock.method(globalThis,'fetch',async()=>new Response(Buffer.from('fake-image'),{status:200}));
  t.mock.method(OAuth2Client.prototype,'request',async function(options){
    if(options.method==='POST' && String(options.url).includes('thumbnails/set')){called=true;return {status:200,data:{}};}
    return {data:{items:[{status:{uploadStatus:'processed',privacyStatus:'public'},processingDetails:{processingStatus:'succeeded'}}]}};
  });
  const dest={videoId:'video-snake',shorts:{format:'shorts'}};
  const job={key:'clip.mp4',bytes:5,title:'A clip',thumbnail_key:'covers/snake.jpg'};
  await publishYouTube({youtube:'refresh-test'},job,dest,async()=>{});
  assert.equal(called,true);
  assert.equal(dest.thumbnail,true);
});

test('thumbnailKey 403 permission error halts publication with Needs attention error',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response(Buffer.from('fake-image'),{status:200}));
  t.mock.method(OAuth2Client.prototype,'request',async function(options){
    if(options.method==='POST' && String(options.url).includes('thumbnails/set')){
      throw Object.assign(Error('forbidden'),{response:{status:403,data:{error:{message:'The authenticated user doesn\'t have permissions to upload and set custom video thumbnails.'}}}});
    }
    return {data:{items:[{status:{uploadStatus:'processed',privacyStatus:'public'},processingDetails:{processingStatus:'succeeded'}}]}};
  });
  const dest={videoId:'video-no-thumb',shorts:{format:'shorts'}};
  const job={key:'clip.mp4',bytes:5,title:'A clip',thumbnailKey:'covers/thumb.jpg'};
  await assert.rejects(
    ()=>publishYouTube({youtube:'refresh-test'},job,dest,async()=>{}),
    err=>{
      assert.equal(err.status,403);
      assert.match(err.message,/verification required/i);
      return true;
    }
  );
  assert.equal(dest.thumbnail,false);
  assert.equal(dest.url,undefined);
});
