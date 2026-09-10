import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Service} from '../automation/service.mjs';
import {tools} from '../automation/contracts.mjs';

const noPaths=value=>{const text=JSON.stringify(value);for(const forbidden of ['storage_path','reference_image_path','output_directory','C:\\','/Users/'])assert.ok(!text.includes(forbidden),`Exposed ${forbidden}`);};

test('ChatGPT Assisted prepares, imports, validates and repairs through shared storage',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'sprited-assisted-')),service=new Service(root);
  try{
    await service.init();
    const images=await service.page.evaluate(()=>[35,60,85,110,135,160,185,210].map(value=>{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');x.fillStyle=`rgb(${value} ${value} ${value})`;x.fillRect(16,8,32,48);return c.toDataURL('image/png').split(',')[1];}));
    await writeFile(path.join(root,'reference.png'),Buffer.from(images[0],'base64'));
    const character=(await service.call('character/create',{path:'reference.png',name:'Guardian'})).result;
    const created=await service.call('agent/generate-animation',{character_id:character.id,animation_type:'WALKING',provider:'chatgpt_assisted'});assert.equal(created.success,true,JSON.stringify(created));const animationId=created.result.attempt_id;
    assert.equal(created.result.image_provider,'chatgpt_assisted');
    for(const index of [0,2,3,4,5,6,7])await service.call('agent/submit-frame',{animation_id:animationId,frame_index:index,provider:'chatgpt_assisted',format:'png',image_base64:images[index]});
    const prepared=await service.call('agent/prepare-assisted-request',{animation_id:animationId,frame_index:1});
    assert.equal(prepared.result.provider_id,'chatgpt_assisted');assert.equal(prepared.result.frame_index,1);assert.match(prepared.result.prompt,/frame 2 of an 8-frame walking animation/i);assert.match(prepared.result.prompt,/previous frame/i);assert.match(prepared.result.prompt,/next frame/i);assert.equal(prepared.result.asset_references.previous.startsWith('frame:'),true);assert.equal(prepared.result.asset_references.next.startsWith('frame:'),true);noPaths(prepared);
    await service.call('agent/submit-frame',{animation_id:animationId,frame_index:1,provider:'chatgpt_assisted',format:'png',image_base64:images[1]});
    const validation=await service.call('agent/validate-animation',{animation_id:animationId});assert.equal(validation.result.frame_count,8);
    await service.call('agent/semantic-validate-animation',{animation_id:animationId,supervisor_result:{passed:false,score:45,issues:[{type:'leg_progression',frame_index:5,severity:'high',description:'The same leg remains forward instead of alternating.'}],bad_frames:[5]}});
    const plan=(await service.call('agent/get-repair-plan',{animation_id:animationId})).result;
    const repair=await service.call('agent/prepare-assisted-request',{animation_id:animationId,frame_index:5,repair_plan_id:plan.repair_plan_id});
    assert.equal(repair.result.request_kind,'repair');assert.match(repair.result.prompt,/Repair frame 6 of 8 only/);assert.match(repair.result.prompt,/same leg remains forward/i);assert.match(repair.result.prompt,/previous frame/i);assert.match(repair.result.prompt,/next frame/i);noPaths(repair);
    const before=(await service.call('agent/list-frames',{animation_id:animationId})).result[5];
    const imported=await service.call('agent/submit-repair-frame',{repair_plan_id:plan.repair_plan_id,frame_index:5,provider:'chatgpt_assisted',format:'png',image_base64:images[4]});assert.equal(imported.result.frame.frame_id,before.frame_id);assert.equal(imported.result.frame.provider,'chatgpt_assisted');
    const evaluated=await service.call('agent/evaluate-repair',{repair_plan_id:plan.repair_plan_id});assert.equal(evaluated.result.semantic_status,'needs_reinspection');
    assert.ok(tools.some(tool=>tool.name==='prepare_assisted_request'));assert.equal(JSON.stringify(tools).includes('cookie'),false);assert.equal(JSON.stringify(tools).includes('password'),false);
  }finally{await service.close();await rm(root,{recursive:true,force:true});}
});
