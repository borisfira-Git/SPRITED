import {createActionMotionSpec,createMotionTimeline,buildVirtualMotion,validateVirtualMotion,createSamplingPlan} from './motion-engine.mjs';

/**
 * @typedef {Object} PhaseSpec
 * @property {number} phase_index
 * @property {string} phase_name
 * @property {'left'|'right'} stance_leg
 * @property {'left'|'right'} swing_leg
 * @property {Object} foot_contact_state
 * @property {Object} lead_trail_relationship
 * @property {Object} knee_state
 * @property {string} pelvis_body_vertical_phase
 * @property {Object} weight_transfer_state
 * @property {Object} contralateral_relationship
 * @property {number} previous_phase_index
 * @property {number} next_phase_index
 * @property {number} paired_phase_index
 * @property {boolean} is_primary_anchor
 * @property {Object} transition_to_next
 */

/** @typedef {{phase_index:number,phase_name:string,anchor_type:'contact'|'passing',paired_phase_index:number}} PoseAnchor */

const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};
const phase=(phase_index,phase_name,phase_class,stance_leg,swing_leg,foot_contact_state,lead_trail_relationship,knee_state,pelvis_body_vertical_phase,weight_transfer_state,contralateral_relationship,previous_phase_index,next_phase_index,paired_phase_index,is_primary_anchor,transition_to_next)=>({phase_index,phase_name,phase_class,stance_leg,swing_leg,foot_contact_state,lead_trail_relationship,knee_state,pelvis_body_vertical_phase,weight_transfer_state,contralateral_relationship,previous_phase_index,next_phase_index,paired_phase_index,is_primary_anchor,transition_to_next});

/**
 * Authoritative canonical WALKING cycle. Labels are identifiers only; no
 * mechanical property is inferred from the words "left" or "right".
 * @type {readonly PhaseSpec[]}
 */
export const WALKING_PHASE_SPECS=freeze([
  phase(0,'Left Contact','contact','left','right',
    {left:'heel contact beginning stance',right:'toe contact ending stance',support:'double support'},
    {lead_leg:'left',trail_leg:'right',state:'left reaches forward while right trails'},
    {left:'extended for heel contact',right:'extended behind before toe-off'},'neutral height, beginning descent',
    {from_leg:'right',to_leg:'left',state:'initial transfer onto left'},
    {forward_leg:'left',forward_arm:'right',back_leg:'right',back_arm:'left',state:'right arm counters forward left leg'},
    7,1,4,true,{contact_progression:'left heel becomes loaded while right toes prepare release',vertical_progression:'descend to cycle minimum',weight_progression:'accept weight onto left',limb_progression:'left knee flexes while right begins recovery'}),
  phase(1,'Left Down','down','left','right',
    {left:'full foot loaded',right:'toe release',support:'left-dominant double-to-single support'},
    {lead_leg:'left',trail_leg:'right',state:'left remains forward and loaded while right leaves trail'},
    {left:'flexed for shock absorption',right:'flexing into recovery'},'lowest point',
    {from_leg:'right',to_leg:'left',state:'weight acceptance completed on left'},
    {forward_leg:'left',forward_arm:'right',back_leg:'right',back_arm:'left',state:'opposed limbs return toward center'},
    0,2,5,false,{contact_progression:'left stays planted while right becomes airborne',vertical_progression:'rise from low toward neutral',weight_progression:'center mass over left support',limb_progression:'right knee flexes and advances toward left'}),
  phase(2,'Left Passing','passing','left','right',
    {left:'full-foot single support',right:'airborne passing stance leg',support:'left single support'},
    {lead_leg:null,trail_leg:null,state:'right swing leg passes beside left stance leg'},
    {left:'near extended in support',right:'maximally flexed for clearance'},'neutral height, rising',
    {from_leg:'left',to_leg:'left',state:'weight centered over left stance leg'},
    {forward_leg:'right',forward_arm:'left',back_leg:'left',back_arm:'right',state:'arms cross near neutral as right passes forward'},
    1,3,6,true,{contact_progression:'left rolls toward forefoot while right stays airborne',vertical_progression:'rise to cycle maximum',weight_progression:'left stance propels body',limb_progression:'right knee begins extending ahead; left prepares push-off'}),
  phase(3,'Left Up','up','left','right',
    {left:'forefoot and toe push-off',right:'airborne advancing to contact',support:'late left single support'},
    {lead_leg:'right',trail_leg:'left',state:'right swing leg leads while left support leg trails'},
    {left:'extended for push-off',right:'flexed then extending toward contact'},'highest point',
    {from_leg:'left',to_leg:'right',state:'propulsion from left toward right contact'},
    {forward_leg:'right',forward_arm:'left',back_leg:'left',back_arm:'right',state:'left arm counters forward right leg'},
    2,4,7,false,{contact_progression:'left toes finish push-off as right heel reaches contact',vertical_progression:'begin descending from high point',weight_progression:'begin transfer left to right',limb_progression:'right completes reach; left finishes trailing stance'}),
  phase(4,'Right Contact','contact','right','left',
    {left:'toe contact ending stance',right:'heel contact beginning stance',support:'double support'},
    {lead_leg:'right',trail_leg:'left',state:'right reaches forward while left trails'},
    {left:'extended behind before toe-off',right:'extended for heel contact'},'neutral height, beginning descent',
    {from_leg:'left',to_leg:'right',state:'initial transfer onto right'},
    {forward_leg:'right',forward_arm:'left',back_leg:'left',back_arm:'right',state:'left arm counters forward right leg'},
    3,5,0,true,{contact_progression:'right heel becomes loaded while left toes prepare release',vertical_progression:'descend to cycle minimum',weight_progression:'accept weight onto right',limb_progression:'right knee flexes while left begins recovery'}),
  phase(5,'Right Down','down','right','left',
    {left:'toe release',right:'full foot loaded',support:'right-dominant double-to-single support'},
    {lead_leg:'right',trail_leg:'left',state:'right remains forward and loaded while left leaves trail'},
    {left:'flexing into recovery',right:'flexed for shock absorption'},'lowest point',
    {from_leg:'left',to_leg:'right',state:'weight acceptance completed on right'},
    {forward_leg:'right',forward_arm:'left',back_leg:'left',back_arm:'right',state:'opposed limbs return toward center'},
    4,6,1,false,{contact_progression:'right stays planted while left becomes airborne',vertical_progression:'rise from low toward neutral',weight_progression:'center mass over right support',limb_progression:'left knee flexes and advances toward right'}),
  phase(6,'Right Passing','passing','right','left',
    {left:'airborne passing stance leg',right:'full-foot single support',support:'right single support'},
    {lead_leg:null,trail_leg:null,state:'left swing leg passes beside right stance leg'},
    {left:'maximally flexed for clearance',right:'near extended in support'},'neutral height, rising',
    {from_leg:'right',to_leg:'right',state:'weight centered over right stance leg'},
    {forward_leg:'left',forward_arm:'right',back_leg:'right',back_arm:'left',state:'arms cross near neutral as left passes forward'},
    5,7,2,true,{contact_progression:'right rolls toward forefoot while left stays airborne',vertical_progression:'rise to cycle maximum',weight_progression:'right stance propels body',limb_progression:'left knee begins extending ahead; right prepares push-off'}),
  phase(7,'Right Up','up','right','left',
    {left:'airborne advancing to contact',right:'forefoot and toe push-off',support:'late right single support'},
    {lead_leg:'left',trail_leg:'right',state:'left swing leg leads while right support leg trails'},
    {left:'flexed then extending toward contact',right:'extended for push-off'},'highest point',
    {from_leg:'right',to_leg:'left',state:'propulsion from right toward left contact'},
    {forward_leg:'left',forward_arm:'right',back_leg:'right',back_arm:'left',state:'right arm counters forward left leg'},
    6,0,3,false,{contact_progression:'right toes finish push-off as left heel reaches contact',vertical_progression:'begin descending from high point',weight_progression:'begin transfer right to left',limb_progression:'left completes reach; right finishes trailing stance'})
]);

const walkPoseId=spec=>spec.phase_name.toLowerCase().replaceAll(' ','-');
export const WALKING_ACTION_MOTION_SPEC=createActionMotionSpec({
  action_type:'WALKING',cyclic:true,start_state:'left-contact',end_state:'left-contact',direction_of_movement:'forward',
  key_poses:WALKING_PHASE_SPECS.map(spec=>({id:walkPoseId(spec),name:spec.phase_name,timeline_position:spec.phase_index/8,is_anchor:spec.is_primary_anchor,motion_state:spec.phase_class,virtual_motion_state:{center_of_mass_progression:spec.weight_transfer_state.state,body_vertical_position:spec.pelvis_body_vertical_phase,weight_distribution:spec.weight_transfer_state,balance_state:spec.foot_contact_state.support,pelvis_state:spec.pelvis_body_vertical_phase,torso_state:'balanced over progressing support',left_arm_trajectory_state:spec.contralateral_relationship.forward_arm==='left'?'forward counter-swing':'back counter-swing',right_arm_trajectory_state:spec.contralateral_relationship.forward_arm==='right'?'forward counter-swing':'back counter-swing',left_leg_trajectory_state:spec.knee_state.left,right_leg_trajectory_state:spec.knee_state.right,major_limb_relationships:spec.contralateral_relationship,support_contact_state:spec.foot_contact_state,motion_direction:'forward'},required_observation_fields:['body_vertical_state','weight_direction','left_right_limb_relationship','contact_support_state'],expected_observation:{body_vertical_state:spec.pelvis_body_vertical_phase,weight_direction:spec.weight_transfer_state,left_right_limb_relationship:spec.contralateral_relationship,contact_support_state:spec.foot_contact_state}})),
  motion_events:[{id:'left-contact-event',name:'Left foot contact',timeline_position:0,type:'contact'},{id:'right-contact-event',name:'Right foot contact',timeline_position:.5,type:'contact'}],
  motion_segments:WALKING_PHASE_SPECS.map(spec=>{const next=WALKING_PHASE_SPECS[spec.next_phase_index];return {id:`${walkPoseId(spec)}->${walkPoseId(next)}`,source_motion_state:walkPoseId(spec),target_motion_state:walkPoseId(next),timeline_range:[spec.phase_index/8,(spec.phase_index+1)/8],expected_trajectory:{motion_direction:'forward',contact_progression:spec.transition_to_next.contact_progression},expected_body_progression:{vertical_progression:spec.transition_to_next.vertical_progression,weight_progression:spec.transition_to_next.weight_progression},expected_limb_progression:spec.transition_to_next.limb_progression,velocity_intent:'continuous gait progression',acceleration_intent:'even cyclic cadence',easing:'constant',important_event_boundaries:next.phase_class==='contact'?[`${walkPoseId(next)}-event`]:[],repair_range:[spec.phase_index/8,(spec.phase_index+1)/8]};}),
  body_mechanics:{center_of_mass:'progresses over alternating support legs',vertical_cycle:'down phases are lowest; up phases are highest'},weight_shift:'alternates left and right support',center_of_mass_progression:'continuous forward cyclic progression',major_limb_trajectories:'contralateral arm and leg swing',loop_seam:{source:'right-up',target:'left-contact',expected:'continuous right push-off into left contact'},important_anchor_pose_ids:['left-contact','left-passing','right-contact','right-passing'],expected_temporal_progression:'contact → down → passing → up, alternating sides and closing the loop',sampling_intent:{mode:'anchor-preserving',anchor_priority:['left-contact','right-contact','left-passing','right-passing']},
  action_specific_mechanics:{kind:'walking-gait',phase_specs:WALKING_PHASE_SPECS}
});
export const WALKING_MOTION_TIMELINE=createMotionTimeline(WALKING_ACTION_MOTION_SPEC);
export const WALKING_VIRTUAL_MOTION=buildVirtualMotion(WALKING_ACTION_MOTION_SPEC,{timeline:WALKING_MOTION_TIMELINE});

export function actionMotionSpecFor(run={}){
  if(run.action_motion_spec?.schema==='action-motion-spec/v1')return run.action_motion_spec;
  if(run.recipe_snapshot?.action_motion_spec)return createActionMotionSpec(run.recipe_snapshot.action_motion_spec);
  if(run.animation_type==='WALKING')return WALKING_ACTION_MOTION_SPEC;
  const cyclic=Boolean(run.options?.loop??run.recipe_snapshot?.loop),declared=run.recipe_snapshot?.motion_template?.phases||[],phases=declared.length?declared:['Start','End'],last=phases.length-1;
  return createActionMotionSpec({action_type:run.animation_type||'CUSTOM',cyclic,key_poses:phases.map((name,index)=>({id:`phase-${index}`,name,timeline_position:cyclic?index/phases.length:(last?index/last:0),is_anchor:index===0||index===last})),body_mechanics:run.recipe_snapshot?.motion_template?.body_mechanics||null,direction_of_movement:run.options?.direction||null,important_anchor_pose_ids:last?['phase-0',`phase-${last}`]:['phase-0'],expected_temporal_progression:phases.join(' → '),sampling_intent:{mode:'uniform'},action_specific_mechanics:run.recipe_snapshot?.motion_template?.action_specific_mechanics||null});
}

const WALK_PHASES=WALKING_PHASE_SPECS.map(spec=>spec.phase_name.toLowerCase());
export const WALKING_GENERATION_ORDER=Object.freeze([0,4,2,6,1,3,5,7]);
const WALKING_ANCHOR_CONTEXT=Object.freeze({0:[6,2],1:[0,2],2:[0,4],3:[2,4],4:[2,6],5:[4,6],6:[4,0],7:[6,0]});
const pairIndex=(index,total)=>total>=4&&total%2===0?((index+total/2)%total):null;
const sideFor=value=>/^left\b/i.test(value)?'left':/^right\b/i.test(value)?'right':null;
const opposite=value=>value==='left'?'right':value==='right'?'left':null;

function walkingFrame(spec){
  const previous=WALKING_PHASE_SPECS[spec.previous_phase_index],next=WALKING_PHASE_SPECS[spec.next_phase_index],paired=WALKING_PHASE_SPECS[spec.paired_phase_index],lead=spec.lead_trail_relationship.lead_leg,trail=spec.lead_trail_relationship.trail_leg,[previous_anchor_index,next_anchor_index]=WALKING_ANCHOR_CONTEXT[spec.phase_index];
  const transition_to_next={from_phase_index:spec.phase_index,from_phase_name:spec.phase_name,to_phase_index:next.phase_index,to_phase_name:next.phase_name,cyclic:next.phase_index===0,...spec.transition_to_next,expected_relationship:`advance continuously from ${spec.phase_name} to ${next.phase_name}`};
  const pose_anchor=spec.is_primary_anchor?{phase_index:spec.phase_index,phase_name:spec.phase_name,anchor_type:spec.phase_class,paired_phase_index:spec.paired_phase_index}:null;
  return {frame_index:spec.phase_index,phase_index:spec.phase_index,phase_name:spec.phase_name,animation_phase:spec.phase_name.toLowerCase(),motion_phase:spec.phase_name.toLowerCase(),phase_class:spec.phase_class,phase_spec:spec,stance_leg:spec.stance_leg,swing_leg:spec.swing_leg,foot_contact_state:spec.foot_contact_state,lead_trail_relationship:spec.lead_trail_relationship,knee_state:spec.knee_state,pelvis_body_vertical_phase:spec.pelvis_body_vertical_phase,weight_transfer_state:spec.weight_transfer_state,contralateral_relationship:spec.contralateral_relationship,previous_phase_index:previous.phase_index,previous_phase:previous.phase_name,next_phase_index:next.phase_index,next_phase:next.phase_name,paired_phase_index:paired.phase_index,paired_frame_index:paired.phase_index,paired_phase:paired.phase_name.toLowerCase(),previous_anchor_index,next_anchor_index,is_primary_anchor:spec.is_primary_anchor,pose_anchor,transition_to_next,
    anatomical_left_leg_state:spec.stance_leg==='left'?'stance/support':'swing/recovery',anatomical_right_leg_state:spec.stance_leg==='right'?'stance/support':'swing/recovery',anatomical_lead_leg:lead,anatomical_trailing_leg:trail,lead_leg:lead,trailing_leg:trail,planted_foot:spec.stance_leg,lifted_foot:spec.foot_contact_state[spec.swing_leg].includes('airborne')?spec.swing_leg:null,left_knee_state:spec.knee_state.left,right_knee_state:spec.knee_state.right,foot_direction:spec.lead_trail_relationship.state,pelvis_progression:spec.pelvis_body_vertical_phase,pelvis_position:spec.pelvis_body_vertical_phase,pelvis_height:spec.pelvis_body_vertical_phase,pelvis_rotation:`counter-rotate through ${spec.phase_name}`,center_of_mass:spec.weight_transfer_state.state,torso_lean:'balanced over progressing support',shoulder_rotation:spec.contralateral_relationship.state,anatomical_left_arm_state:spec.contralateral_relationship.forward_arm==='left'?'forward counter-swing':'back counter-swing',anatomical_right_arm_state:spec.contralateral_relationship.forward_arm==='right'?'forward counter-swing':'back counter-swing',weight_distribution:spec.weight_transfer_state.state,arm_counter_swing:spec.contralateral_relationship.state,mechanical_instruction:`${spec.phase_name}: ${spec.foot_contact_state.support}; ${spec.weight_transfer_state.state}; ${spec.pelvis_body_vertical_phase}; ${spec.contralateral_relationship.state}`,expected_silhouette_characteristics:spec.lead_trail_relationship.state,neighbor_frame_indexes:[previous.phase_index,next.phase_index],previous_frame_relationship:`arrives continuously from ${previous.phase_name}`,next_frame_relationship:transition_to_next.expected_relationship,loop_relationship:next.phase_index===0?'close the gait cycle continuously into Left Contact':'part of one closed gait cycle',paired_relation:`${paired.phase_name} is the opposite-side mechanical counterpart`,required_neighbor_relation:'continuous progression without duplicate pose',required_paired_relation:'contralateral counterpart; do not preserve identical silhouette'};
}

function legacyFrame(frame_index,phases,frameCount){
  const animation_phase=phases[Math.min(phases.length-1,Math.floor(frame_index*phases.length/Math.max(1,frameCount)))],side=sideFor(animation_phase),paired_frame_index=pairIndex(frame_index,frameCount),paired_phase=paired_frame_index===null?null:phases[Math.min(phases.length-1,Math.floor(paired_frame_index*phases.length/Math.max(1,frameCount)))],phaseClass=/contact|down|passing|up/i.exec(animation_phase||'')?.[0]||'transition',lead=side||'reference-side',trail=opposite(side)||'reference-side';
  return {frame_index,animation_phase,motion_phase:animation_phase,phase_class:phaseClass,anatomical_left_leg_state:side==='left'?'forward/loaded':side==='right'?'trailing/recovering':'transition',anatomical_right_leg_state:side==='right'?'forward/loaded':side==='left'?'trailing/recovering':'transition',anatomical_lead_leg:side,anatomical_trailing_leg:opposite(side),lead_leg:lead,trailing_leg:trail,planted_foot:animation_phase?.includes('contact')?side:null,lifted_foot:animation_phase?.includes('contact')?opposite(side):null,left_knee_state:side==='left'?(phaseClass==='contact'?'extended':'flexed'):(phaseClass==='passing'?'flexed':'recovering'),right_knee_state:side==='right'?(phaseClass==='contact'?'extended':'flexed'):(phaseClass==='passing'?'flexed':'recovering'),foot_direction:side?`toe-forward ${side} lead / ${trail} trail`:'match reference',pelvis_progression:animation_phase?.includes('up')?'raised':animation_phase?.includes('down')?'lowered':'forward',pelvis_position:animation_phase?.includes('contact')?'extended contact':phaseClass==='passing'?'center passing':'progressive',pelvis_height:animation_phase?.includes('up')?'high':animation_phase?.includes('down')?'low':'neutral',pelvis_rotation:side?`rotate toward ${side} lead`:'match reference',center_of_mass:phaseClass==='passing'?'over supporting foot':phaseClass==='contact'?'between feet':'forward progression',torso_lean:phaseClass==='contact'?'slight counter-lean':'forward progression',shoulder_rotation:side?`counter-rotate against ${side} lead`:'match reference',anatomical_left_arm_state:side==='right'?'forward swing':'counter swing',anatomical_right_arm_state:side==='left'?'forward swing':'counter swing',weight_distribution:phaseClass==='contact'?`loaded ${side||'support'} side`:'transfer forward',arm_counter_swing:side?`counter-swing opposite ${side} lead leg`:null,mechanical_instruction:`${animation_phase||'transition'}: ${lead} lead, ${trail} trailing; ${phaseClass} mechanics; advance pelvis and center of mass one phase`,expected_silhouette_characteristics:side?`allow ${side} lead stride silhouette change while preserving identity`:'preserve coherent motion silhouette',neighbor_frame_indexes:[frame_index>0?frame_index-1:null,frame_index<frameCount-1?frame_index+1:null].filter(Number.isInteger),previous_frame_relationship:frame_index>0?'advance exactly one mechanical phase':'wrap from final phase continuously',next_frame_relationship:frame_index<frameCount-1?'advance exactly one mechanical phase':'transition continuously to frame 1',loop_relationship:frame_index===frameCount-1?'continuous return to frame 1':'part of closed mechanical cycle',paired_frame_index,paired_phase,paired_relation:paired_frame_index===null?null:'same phase, opposite lead/trailing legs',required_neighbor_relation:'continuous progression without duplicate pose',required_paired_relation:paired_frame_index===null?null:'contralateral counterpart; do not preserve identical silhouette'};
}

export function buildPosePlan(run,{frameCount=run.options?.output_frames||run.recipe_snapshot?.default_output_frame_count||run.frame_records?.length||0}={}){
  const walking=run.animation_type==='WALKING',action_motion_spec=actionMotionSpecFor(run),motion_timeline=createMotionTimeline(action_motion_spec),virtual_motion=walking&&action_motion_spec===WALKING_ACTION_MOTION_SPEC?WALKING_VIRTUAL_MOTION:buildVirtualMotion(action_motion_spec,{timeline:motion_timeline}),virtual_motion_validation=validateVirtualMotion(virtual_motion);if(!virtual_motion_validation.passed)throw Error(`INVALID_VIRTUAL_MOTION: ${virtual_motion_validation.issues.map(item=>item.type).join(', ')}`);const sampling_plan=createSamplingPlan(virtual_motion,{frameCount,mode:action_motion_spec.sampling_intent?.mode||'uniform'}),sampling_validation=validateVirtualMotion(virtual_motion,{samplingPlan:sampling_plan});if(frameCount>1&&!sampling_validation.passed)throw Error(`INVALID_MOTION_SAMPLING: ${sampling_validation.issues.map(item=>item.type).join(', ')}`);const walkingById=new Map(WALKING_PHASE_SPECS.map(spec=>[walkPoseId(spec),spec])),canonicalWalking=walking&&sampling_plan.samples.every(sample=>walkingById.has(sample.key_pose_id));
  const phases=run.recipe_snapshot?.motion_template?.phases?.length?run.recipe_snapshot.motion_template.phases:frameCount===8?WALK_PHASES:Array.from({length:frameCount},(_,index)=>`phase ${index+1}`);
  const frames=sampling_plan.samples.map((sample,index)=>{const walkSpec=walkingById.get(sample.key_pose_id),base=canonicalWalking&&walkSpec?walkingFrame(walkSpec):legacyFrame(index,walking?WALK_PHASES:phases,frameCount);return {...base,...sample,sampling_context:sample};}),transitions=canonicalWalking?frames.map(frame=>frame.transition_to_next):[],pose_anchors=frames.filter(frame=>frame.is_anchor||frame.is_primary_anchor).map(frame=>frame.pose_anchor||{phase_index:frame.phase_index??frame.frame_index,phase_name:frame.phase_name||frame.key_pose_name,anchor_type:frame.phase_class||'key_pose',paired_phase_index:frame.paired_phase_index??null});
  return {version:3,blueprint_schema:'temporal-motion-blueprint/v3',cycle_type:action_motion_spec.cyclic?'continuous_cyclic_motion':'ordered_motion',animation_type:run.animation_type,frame_count:frameCount,generation_order:[...sampling_plan.generation_order],action_motion_spec,motion_timeline,virtual_motion,virtual_motion_validation,sampling_validation,motion_segments:action_motion_spec.motion_segments,sampling_plan,phase_specs:walking?WALKING_PHASE_SPECS:[],pose_anchors,transitions,frames,paired_frames:frames.filter(frame=>frame.paired_frame_index!==null).map(frame=>({frame_index:frame.frame_index,paired_frame_index:frame.paired_frame_index,phase:frame.animation_phase,paired_phase:frame.paired_phase,lead_trail_swap_required:true})),priority_order:['animation phase correctness','anatomical left/right correctness','lead/trail leg relationship','pelvis / weight progression','character identity','equipment consistency','silhouette consistency']};
}

export function poseFor(plan,index){return plan?.frames?.find(frame=>frame.frame_index===index)||null;}

export function createRepairPlanDetails({pose,issue,description,pairedFrame=null,neighbors=[],strategy='frame_local'}={}){
  const gait=pose?.anatomical_lead_leg&&['contact','down','passing','up'].some(name=>pose.animation_phase?.includes(name));
  const mustChange=gait&&issue&&['leg_progression','bad_weight_transfer','broken_contact_pose','broken_passing_pose','no_forward_progression'].includes(issue)?[`correct ${pose.anatomical_lead_leg} lead leg and ${pose.anatomical_trailing_leg} trailing leg`,`match ${pose.animation_phase} pelvis/weight progression`,'allow the expected contralateral silhouette change']:['correct the reported defect'];
  const mustPreserve=['character identity and proportions','armor/clothing, colors and equipment','camera angle, direction, scale and framing'];
  return {target_issue:issue||'other',target_frame:pose?.frame_index??null,target_phase:pose?.animation_phase||null,current_failure:description||issue||'reported validation issue',likely_cause:gait?'paired-frame / contralateral gait relationship':null,must_change:mustChange,must_not_change:mustPreserve,neighbor_frames:neighbors,paired_frame:pairedFrame?{frame_index:pairedFrame.frame_index,phase:pairedFrame.animation_phase,lead_leg:pairedFrame.anatomical_lead_leg,required_relation:pairedFrame.required_paired_relation}:null,strategy_selected:strategy,repair_dimension:gait?'lead/trail leg correction':'focused frame-local correction',expected_measurable_improvement:['target issue score improves','no critical identity/anatomy regression',...(pairedFrame?['lead_trail_swap_correct','paired_phase_match']:[])],rollback_condition:'reject if target issue worsens or BEST_KNOWN_RESULT materially regresses'};
}

export function validatePairedPoseRelation(plan,observed={}){const diagnostics=[];for(const pair of plan?.paired_frames||[]){const left=observed[pair.frame_index],right=observed[pair.paired_frame_index],a=plan.frames[pair.frame_index],b=plan.frames[pair.paired_frame_index];if(!a||!b)continue;const swapped=left?.lead_leg&&right?.lead_leg?left.lead_leg!==right.lead_leg:true;diagnostics.push({frame_index:pair.frame_index,paired_frame_index:pair.paired_frame_index,paired_phase_match:a.animation_phase===b.paired_phase,lead_trail_swap_correct:swapped,stride_amplitude_symmetry:observed.stride_amplitude_symmetry??null,pelvis_progression_symmetry:observed.pelvis_progression_symmetry??null,arm_counter_swing_match:observed.arm_counter_swing_match??null,incorrect_same_side_repetition:!swapped});}return diagnostics;}
export function validateMotionProgression(plan,observed={}){const diagnostics=[],frames=plan?.frames||[];for(let index=0;index<frames.length;index++){const current=frames[index],next=frames[(index+1)%frames.length],actual=observed[index]||{},nextActual=observed[(index+1)%frames.length]||{},mechanicalDuplicate=actual.mechanical_signature&&actual.mechanical_signature===nextActual.mechanical_signature,phaseSkipped=actual.phase_class&&nextActual.phase_class===actual.phase_class&&current.phase_class!==next.phase_class,sideWrong=actual.lead_leg&&current.lead_leg&&actual.lead_leg!==current.lead_leg;diagnostics.push({frame_index:index,next_frame_index:(index+1)%frames.length,duplicate_mechanical_pose:Boolean(mechanicalDuplicate),insufficient_pose_separation:Boolean(mechanicalDuplicate),skipped_phase:Boolean(phaseSkipped),reversed_progression:Boolean(sideWrong),frozen_limb:Boolean(actual.frozen_limb),broken_loop:index===frames.length-1&&Boolean(actual.loop_break),natural_transition:!mechanicalDuplicate&&!phaseSkipped&&!sideWrong});}return diagnostics;}
