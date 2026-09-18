import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimationPipelineController} from '../automation/animation-pipeline-controller.mjs';

test('internal pipeline generates, validates, repairs, revalidates, previews and builds a sheet without an external agent',async()=>{
  const calls=[],run={id:'run-1',animation_type:'WALKING',character_profile_id:'character-1',frame_records:[],technical_validation:null};let validationCount=0;
  const service={
    experienceService:{rank_repair_strategies:()=>({repair_action:'regenerate',strategy_source:'experience',historical_attempts:2,historical_success_rate:1})},
    prepareAnimationRun:async()=>({job:{attempt_id:'run-1'},provider:'cloudflare_flux',frame_count:8,user_action_required:false,run:{pose_plan:{generation_order:[0,4,2,6,1,3,5,7]}}}),
    storeProviderFrame:async args=>{calls.push(['generate',args.frame_index]);run.frame_records.push({frame_id:`frame-${args.frame_index}`,frame_index:args.frame_index});},
    runTechnicalValidation:async()=>{validationCount++;const failed=validationCount===1;run.technical_validation={passed:!failed,score:failed?70:100,issues:failed?[{type:'visual_jump',frame:3,severity:'high'}]:[],bad_frames:failed?[{frame_index:3,reasons:['visual_jump']}]:[],loop_validation:{passed:true,loop_score:100},temporal_validation:{status:'PASS',passed:true,motion_approved:true}};return run.technical_validation;},
    recordProgress:async(...args)=>calls.push(['progress',args[1]]),
    submitRepairFrame:async args=>calls.push(['repair',args.frame_index,args.strategy_source]),
    evaluateRepairDeterministic:async()=>service.runTechnicalValidation(),
    buildGifPreview:async()=>{calls.push(['gif']);return {preview_id:'gif-1'};},
    execute:async(action,args)=>{calls.push(['sheet',action,args.id]);return {success:true,result:{id:'sheet-1'},output_paths:['sheet.png']};},
    core:async(operation,args)=>{if(operation==='workflow/animation/status')return structuredClone(run);if(operation==='workflow/animation/record-repair-plan'){run.repair_plans=[args.plan];return args.plan;}throw Error(`Unexpected ${operation}`);},
    persist:async()=>calls.push(['persist']),markPipelineFailed:async()=>assert.fail('pipeline should not fail')
  };
  const supervisor={suggest:async(_context,fallback)=>({...fallback,strategy_source:'sprited',supervisor_used:false})},controller=new AnimationPipelineController(service,{supervisor,maxRepairAttempts:2}),result=await controller.run({character_id:'character-1',animation_type:'WALKING',provider:'cloudflare_flux'});
  assert.equal(result.status,'ready');assert.equal(result.frames_stored,8);assert.equal(validationCount,2);assert.deepEqual(calls.filter(item=>item[0]==='generate').map(item=>item[1]),[0,4,2,6,1,3,5,7]);assert.deepEqual(run.frame_records.map(frame=>frame.frame_index).toSorted((a,b)=>a-b),[0,1,2,3,4,5,6,7]);assert.deepEqual(calls.find(item=>item[0]==='repair').slice(1),[3,'sprited']);assert.ok(calls.some(item=>item[0]==='gif'));assert.ok(calls.some(item=>item[0]==='sheet'&&item[1]==='agent/build-spritesheet'));
});

test('technical success without motion observation cannot complete the pipeline',async()=>{const service={prepareAnimationRun:async()=>({job:{attempt_id:'run-motion'},provider:'local_process',frame_count:8,user_action_required:false,run:{pose_plan:{generation_order:[0,4,2,6,1,3,5,7]}}}),storeProviderFrame:async()=>{},runTechnicalValidation:async()=>({passed:true,score:100,bad_frames:[],loop_validation:{passed:true},temporal_validation:{status:'INSUFFICIENT_MOTION_OBSERVATION',passed:false,motion_approved:false}}),autoAcceptAnimation:async()=>({accepted:false})},controller=new AnimationPipelineController(service,{}),result=await controller.run({animation_type:'WALKING'});assert.equal(result.status,'motion_observation_required');assert.equal(result.temporal_validation.passed,false);});

test('manual provider pauses cleanly and does not require Codex or generation',async()=>{let generated=false;const service={prepareAnimationRun:async()=>({job:{attempt_id:'manual-1'},provider:'external_manual',frame_count:8,user_action_required:true}),storeProviderFrame:async()=>{generated=true;}};const controller=new AnimationPipelineController(service,{}),result=await controller.run({character_id:'c',animation_type:'IDLE'});assert.equal(result.status,'user_action_required');assert.equal(generated,false);});
