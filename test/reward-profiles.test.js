import {test} from 'node:test';
import assert from 'node:assert/strict';
import {profilePath,hasBrowserProfile} from '../home-worker/content-rewards.js';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('profile detection requires saved browser preferences for the specific account',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'relay-profiles-'));
 const previous=process.env.CONTENT_REWARDS_PROFILES_DIR;
 process.env.CONTENT_REWARDS_PROFILES_DIR=directory;
 try{
  assert.equal(await hasBrowserProfile('account-a'),false);
  await mkdir(join(profilePath('account-a'),'Default'),{recursive:true});
  assert.equal(await hasBrowserProfile('account-a'),false);
  await writeFile(join(profilePath('account-a'),'Default','Preferences'),'{}');
  assert.equal(await hasBrowserProfile('account-a'),true);
  assert.equal(await hasBrowserProfile('account-b'),false);
 }finally{
  if(previous===undefined)delete process.env.CONTENT_REWARDS_PROFILES_DIR;else process.env.CONTENT_REWARDS_PROFILES_DIR=previous;
  await rm(directory,{recursive:true,force:true});
 }
});
test('reward accounts have isolated profiles and cannot escape their profile directory',()=>{
 assert.notEqual(profilePath('account-a'),profilePath('account-b'));
 assert.equal(profilePath('account-a'),profilePath('account-a'));
 for(const id of [undefined,'../account-a','a/b','C:\\profile'])assert.throws(()=>profilePath(id));
});
