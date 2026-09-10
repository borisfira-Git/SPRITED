import test from 'node:test';
import assert from 'node:assert/strict';
import {ExternalManualVisionProvider,combineValidation} from '../automation/semantic-validator.mjs';

const provider=new ExternalManualVisionProvider();
test('normalizes passing frame semantic validation',async()=>{
  const result=await provider.validate_frame({animation_id:'animation-1',frame_id:'frame-1',supervisor_result:{passed:true,score:94,issues:[]}});
  assert.equal(result.passed,true);assert.equal(result.semantic_score,94);assert.equal(result.frame_id,'frame-1');assert.deepEqual(result.bad_frames,[]);
});
test('normalizes animation issues and bad frame indexes',async()=>{
  const result=await provider.validate_animation({animation_id:'animation-1',max_frame_index:7,supervisor_result:{passed:false,score:42,issues:[{type:'leg_progression',frame_index:5,severity:'high',description:'The same leg remains forward.'}],bad_frames:[5]}});
  assert.equal(result.passed,false);assert.deepEqual(result.bad_frames,[5]);
});
test('rejects invalid semantic results',async()=>{
  await assert.rejects(()=>provider.validate_frame({animation_id:'a',frame_id:'f',supervisor_result:{passed:true,score:101,issues:[]}}),/Invalid semantic validation result/);
});
test('combined validation fails when either required validator fails',()=>{
  assert.equal(combineValidation({passed:true,score:91},{passed:false,semantic_score:45}).overall_passed,false);
  assert.equal(combineValidation({passed:false,score:50},{passed:true,semantic_score:95}).overall_passed,false);
  assert.equal(combineValidation({passed:true,score:91},{passed:true,semantic_score:95}).overall_passed,true);
});
