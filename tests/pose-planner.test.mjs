import test from 'node:test';
import assert from 'node:assert/strict';
import {WALKING_ACTION_MOTION_SPEC,WALKING_PHASE_SPECS,buildPosePlan,createRepairPlanDetails,validatePairedPoseRelation,validateMotionProgression} from '../automation/pose-planner.mjs';
import {createRepairPlan} from '../automation/repair-orchestrator.mjs';
import {prepareAssistedRequest} from '../automation/chatgpt-assisted.mjs';
import {ExternalManualVisionProvider} from '../automation/semantic-validator.mjs';

const run={id:'walk',animation_type:'WALKING',character_profile_id:'c',options:{output_frames:8,canvas_width:256,canvas_height:256},recipe_snapshot:{default_output_frame_count:8,motion_template:{phases:['left contact','left down','left passing','left up','right contact','right down','right passing','right up']}},frame_records:Array.from({length:8},(_,frame_index)=>({frame_index,frame_id:`f${frame_index}`})),technical_validation:{score:50,issues:[{type:'leg_progression',frame_index:4,severity:'high',description:'wrong lead leg'}]},semantic_validation:null,repair_plans:[]};

test('canonical walking blueprint contains all eight phases in order',()=>{
  const plan=buildPosePlan(run);
  assert.equal(WALKING_PHASE_SPECS.length,8);
  assert.deepEqual(plan.phase_specs.map(spec=>spec.phase_name),['Left Contact','Left Down','Left Passing','Left Up','Right Contact','Right Down','Right Passing','Right Up']);
  assert.equal(plan.cycle_type,'continuous_cyclic_motion');
});

test('walking phase links and transitions form a closed cycle',()=>{
  const plan=buildPosePlan(run);
  for(const phase of plan.phase_specs){
    assert.equal(phase.previous_phase_index,(phase.phase_index+7)%8);
    assert.equal(phase.next_phase_index,(phase.phase_index+1)%8);
    assert.equal(plan.transitions[phase.phase_index].from_phase_index,phase.phase_index);
    assert.equal(plan.transitions[phase.phase_index].to_phase_index,phase.next_phase_index);
  }
  assert.equal(plan.transitions[7].from_phase_name,'Right Up');
  assert.equal(plan.transitions[7].to_phase_name,'Left Contact');
  assert.equal(plan.transitions[7].cyclic,true);
});

test('paired contact and passing phases are explicit opposites',()=>{
  const plan=buildPosePlan(run),frames=plan.frames;
  assert.deepEqual(frames.map(frame=>frame.paired_phase_index),[4,5,6,7,0,1,2,3]);
  assert.equal(frames[0].paired_phase,'right contact');
  assert.equal(frames[4].paired_phase,'left contact');
  assert.equal(frames[2].paired_phase,'right passing');
  assert.equal(frames[6].paired_phase,'left passing');
  assert.notEqual(frames[0].stance_leg,frames[4].stance_leg);
  assert.notEqual(frames[2].stance_leg,frames[6].stance_leg);
});

test('stance and swing legs alternate by half-cycle',()=>{
  const plan=buildPosePlan(run);
  assert.deepEqual(plan.frames.map(frame=>frame.stance_leg),['left','left','left','left','right','right','right','right']);
  assert.deepEqual(plan.frames.map(frame=>frame.swing_leg),['right','right','right','right','left','left','left','left']);
  for(const frame of plan.frames)assert.notEqual(frame.stance_leg,frame.swing_leg);
});

test('only contact and passing phases are primary pose anchors',()=>{
  const plan=buildPosePlan(run);
  assert.deepEqual(plan.frames.filter(frame=>frame.is_primary_anchor).map(frame=>frame.phase_name),['Left Contact','Left Passing','Right Contact','Right Passing']);
  assert.deepEqual(plan.pose_anchors.map(anchor=>anchor.phase_index),[0,2,4,6]);
});

test('walking blueprint declares anchor-first generation and surrounding anchor context',()=>{
  const plan=buildPosePlan(run);
  assert.deepEqual(plan.generation_order,[0,4,2,6,1,3,5,7]);
  assert.deepEqual(plan.frames.map(frame=>[frame.previous_anchor_index,frame.next_anchor_index]),[[6,2],[0,2],[0,4],[2,4],[2,6],[4,6],[4,0],[6,0]]);
});

test('WALKING is an ActionMotionSpec whose mechanics do not depend on frame count',()=>{const six=buildPosePlan({...run,options:{...run.options,output_frames:6}},{frameCount:6}),twelve=buildPosePlan({...run,options:{...run.options,output_frames:12}},{frameCount:12});assert.equal(six.action_motion_spec,WALKING_ACTION_MOTION_SPEC);assert.equal(twelve.action_motion_spec,WALKING_ACTION_MOTION_SPEC);assert.equal(six.sampling_plan.samples.length,6);assert.equal(twelve.sampling_plan.samples.length,12);assert.deepEqual(six.action_motion_spec.key_poses,twelve.action_motion_spec.key_poses);assert.equal(six.action_motion_spec.action_specific_mechanics.kind,'walking-gait');});

test('pose plan pairs opposite gait phases and swaps lead legs',()=>{const plan=buildPosePlan(run);assert.equal(plan.frames[0].animation_phase,'left contact');assert.equal(plan.frames[4].animation_phase,'right contact');assert.equal(plan.frames[0].paired_frame_index,4);assert.equal(plan.frames[4].paired_frame_index,0);assert.equal(plan.frames[0].anatomical_lead_leg,'left');assert.equal(plan.frames[4].anatomical_lead_leg,'right');assert.equal(plan.frames[0].required_paired_relation,'contralateral counterpart; do not preserve identical silhouette');});
test('repair plan carries must-change, preserve, neighbor and paired context',()=>{const plan=createRepairPlan(run),target=plan.frames_to_repair[0];assert.ok(plan.pose_plan);assert.equal(target.paired_frame_index,0);assert.deepEqual(target.repair_plan_details.neighbor_frames,[3,5]);assert.ok(target.repair_plan_details.must_change.some(item=>/lead leg/i.test(item)));assert.ok(target.repair_plan_details.must_not_change.some(item=>/identity/i.test(item)));});
test('prompt uses pose and paired-frame requirements without silhouette over-constraint',()=>{const plan=createRepairPlan(run),request=prepareAssistedRequest({run:{...run,pose_plan:plan.pose_plan},frameIndex:4,repairPlan:plan});assert.match(request.prompt,/Pose Plan: right contact/i);assert.match(request.prompt,/paired contralateral frame/i);assert.match(request.prompt,/Preserve character identity, not the previous body contour/i);assert.equal(request.asset_references.paired,'frame:f0');});
test('paired diagnostics flag same-side repetition',()=>{const plan=buildPosePlan(run),diagnostics=validatePairedPoseRelation(plan,{0:{lead_leg:'left'},4:{lead_leg:'left'}});assert.equal(diagnostics[0].lead_trail_swap_correct,false);assert.equal(diagnostics[0].incorrect_same_side_repetition,true);});
test('repair details prioritize gait correctness over silhouette',()=>{const plan=buildPosePlan(run),details=createRepairPlanDetails({pose:plan.frames[4],issue:'leg_progression',description:'same side repeated',pairedFrame:plan.frames[0],neighbors:[3,5]});assert.ok(details.must_change.some(item=>/contralateral silhouette/i.test(item)));assert.match(details.must_not_change[0],/identity/i);});
test('semantic validator exposes confidence so weak findings can be down-weighted',async()=>{const result=await new ExternalManualVisionProvider().validate_animation({animation_id:'walk',max_frame_index:7,supervisor_result:{passed:false,score:60,confidence:.3,phase_accuracy:.4,phase_accuracy_confidence:.2,issues:[{type:'leg_progression',frame_index:4,severity:'high',description:'uncertain lead leg'}],bad_frames:[4]}});assert.equal(result.confidence_label,'low');assert.equal(result.phase_accuracy_confidence,.2);});
test('every frame gets unique mechanical blueprint and loop progression is checked',()=>{const plan=buildPosePlan(run);assert.equal(new Set(plan.frames.map(frame=>frame.mechanical_instruction)).size,8);const diagnostics=validateMotionProgression(plan,{7:{loop_break:true}});assert.equal(diagnostics.length,8);assert.equal(diagnostics.at(-1).broken_loop,true);});
test('duplicate mechanical phases are detected',()=>{const plan=buildPosePlan(run),diagnostics=validateMotionProgression(plan,{0:{mechanical_signature:'same'},1:{mechanical_signature:'same'}});assert.equal(diagnostics[0].duplicate_mechanical_pose,true);});
