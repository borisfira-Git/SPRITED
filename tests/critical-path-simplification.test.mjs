import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Service} from '../automation/service.mjs';

test('animation preparation builds the motion plan without running strategy preflight',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'sprited-critical-path-'));
  let posePlanCalls=0,preflightCalls=0;
  const run={id:'walk-run',animation_type:'WALKING',options:{output_frames:8},recipe_snapshot:{loop:true}};
  const service={
    root,defaultImageProvider:'external_manual',
    providerPolicy:{default_provider:'external_manual',fallback_providers:[]},
    imageProviders:{external_manual:{}},
    core:async(operation)=>{
      if(operation==='workflow/recipes/list')return [{animation_type:'WALKING',default_output_frame_count:8,target_duration:1.6,loop:true}];
      if(operation==='workflow/jobs/create')return {attempt_id:'walk-run',output_directory:'attempt'};
      if(operation==='workflow/animation/set-image-provider')return {};
      if(operation==='workflow/animation/status')return run;
      throw Error(`Unexpected operation ${operation}`);
    },
    directory:async relative=>{const result=path.join(root,relative);await mkdir(result,{recursive:true});return result;},
    ensurePosePlan:async()=>{posePlanCalls++;},
    ensurePreflight:async()=>{preflightCalls++;},
    recordProgress:async()=>{}
  };
  try{
    const prepared=await Service.prototype.prepareAnimationRun.call(service,{character_id:'character',animation_type:'WALKING',frames:8,provider:'external_manual'});
    assert.equal(prepared.frame_count,8);
    assert.equal(posePlanCalls,1);
    assert.equal(preflightCalls,0);
  }finally{await rm(root,{recursive:true,force:true});}
});
