import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shortsMetadata} from '../lib/shorts.js';

const metadata=(width=1080,height=1920,seconds=180)=>({duration:seconds*1000,timescale:1000,videoTracks:[{duration:seconds*1000,timescale:1000,video:{width,height}}]});
test('Shorts accept portrait and square clips up to three minutes',()=>{
  assert.equal(shortsMetadata(metadata()).duration,180);
  assert.equal(shortsMetadata(metadata(1080,1080)).format,'shorts');
});
test('Shorts reject long, landscape, fragmented and unreadable clips',()=>{
  for(const info of [metadata(1080,1920,181),metadata(1920,1080),{...metadata(),isFragmented:true},metadata(0,0),metadata(1080,1920,NaN)]){
    assert.throws(()=>shortsMetadata(info),{status:422});
  }
});
test('Shorts eligibility uses displayed dimensions after rotation',()=>{
  const result=shortsMetadata(metadata(1920,1080),[0,65536,0,-65536,0,0,0,0,1073741824]);
  assert.equal(result.width,1080);assert.equal(result.height,1920);
});
