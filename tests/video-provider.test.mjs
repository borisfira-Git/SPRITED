import test from 'node:test';
import assert from 'node:assert/strict';
import {createVideoProvider,MockVideoProvider,HttpVideoProvider,loadVideoEnvironment} from '../automation/video-provider.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildFramesZip} from '../automation/video-pipeline.mjs';

test('video provider defaults to the test-only mock adapter without a key',()=>{
  const provider=createVideoProvider({});
  assert.ok(provider instanceof MockVideoProvider);
  assert.equal(provider.available,true);
});

test('mock adapter never pretends to generate without its test fixture',async()=>{
  const provider=new MockVideoProvider({fixturePath:null});
  await assert.rejects(()=>provider.generateAnimation({prompt:'walk',frames:8}),/SPRITED_MOCK_VIDEO_PATH/);
});

test('HTTP adapter is unavailable until both server-side API URL and key are set',()=>{
  assert.equal(new HttpVideoProvider({apiUrl:'https://example.test/video'}).available,false);
  assert.equal(new HttpVideoProvider({apiUrl:'https://example.test/video',apiKey:'server-secret'}).available,true);
});

test('frame archive is a standards-compatible ZIP container',()=>{
  const archive=buildFramesZip([{name:'frame_000.png',bytes:Buffer.from([1,2,3])}]);
  assert.equal(archive.subarray(0,4).toString('hex'),'504b0304');
  assert.equal(archive.subarray(-22,-18).toString('hex'),'504b0506');
});

test('the server can load video settings from .env without replacing explicit environment values',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'sprited-env-'));try{const file=path.join(dir,'.env');await writeFile(file,'SPRITED_VIDEO_PROVIDER=kling\nSPRITED_VIDEO_API_KEY=from-file\n');const env={SPRITED_VIDEO_API_KEY:'from-process'};await loadVideoEnvironment(file,env);assert.equal(env.SPRITED_VIDEO_PROVIDER,'kling');assert.equal(env.SPRITED_VIDEO_API_KEY,'from-process');}finally{await rm(dir,{recursive:true,force:true});}
});
