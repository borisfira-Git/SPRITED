import {randomUUID} from 'node:crypto';

export const DEFAULT_MAX_REPAIR_ATTEMPTS=3;
const weight=(issue,semantic=false)=>issue.loop?300:issue.severity==='high'?(semantic?500:400):issue.severity==='medium'?200:100;
const targets=issue=>issue.frame_index!==undefined?[issue.frame_index]:issue.frame!==undefined?[issue.frame]:issue.frames?.slice(-1)||[];

export function unresolvedFrames(run){
  const records=new Map((run.frame_records||[]).map(frame=>[frame.frame_index,frame])),ranked=new Map();
  const collect=(issues,semantic=false)=>{for(const issue of issues||[])for(const index of targets(issue)){const frame=records.get(index);if(!frame)continue;const item=ranked.get(index)||{frame_index:index,frame_id:frame.frame_id,reasons:[],issue_descriptions:[],severity:'low',priority:0};if(!item.reasons.includes(issue.type))item.reasons.push(issue.type);const description=issue.description||issue.type.replaceAll('_',' ');if(!item.issue_descriptions.includes(description))item.issue_descriptions.push(description);if(issue.severity==='high'||item.severity==='low')item.severity=issue.severity||item.severity;item.priority=Math.max(item.priority,weight(issue,semantic));ranked.set(index,item);}};
  collect(run.semantic_validation?.issues,true);collect(run.technical_validation?.issues,false);
  return [...ranked.values()].sort((a,b)=>b.priority-a.priority||a.frame_index-b.frame_index).map(({priority,...item})=>({...item,suggested_action:item.reasons.some(reason=>['center_drift','scale_drift','loop_center_jump','loop_scale_jump'].includes(reason))?'replace_or_align':'regenerate'}));
}

export function createRepairPlan(run,{maxAttempts=DEFAULT_MAX_REPAIR_ATTEMPTS}={}){
  const active=(run.repair_plans||[]).findLast(plan=>plan.status==='active');if(active)return structuredClone(active);
  const attempt=(run.repair_plans||[]).length+1;if(attempt>maxAttempts)throw Error('Maximum repair attempts reached');
  const frames=unresolvedFrames(run),byIndex=new Map((run.frame_records||[]).map(frame=>[frame.frame_index,frame]));
  const context=frames.map(frame=>({frame_index:frame.frame_index,current_frame_reference:`frame:${frame.frame_id}`,previous_frame_reference:byIndex.get(frame.frame_index-1)?`frame:${byIndex.get(frame.frame_index-1).frame_id}`:null,next_frame_reference:byIndex.get(frame.frame_index+1)?`frame:${byIndex.get(frame.frame_index+1).frame_id}`:null}));
  return {animation_id:run.id,repair_plan_id:randomUUID(),technical_score:run.technical_validation?.score??null,semantic_score:run.semantic_validation?.semantic_score??null,overall_passed:Boolean(run.combined_validation?.overall_passed),frames_to_repair:frames,repair_context:{character_id:run.character_profile_id,character_reference:`character:${run.character_profile_id}`,contact_sheet_reference:run.current_contact_sheet_id?`contact-sheet:${run.current_contact_sheet_id}`:null,frames:context},attempt,max_attempts:maxAttempts,status:'active',repaired_frame_indexes:[],previous_validation_score:run.technical_validation?.score??null,new_technical_score:null,created_at:new Date().toISOString()};
}

export function getAnimationStatus(run,{maxAttempts=DEFAULT_MAX_REPAIR_ATTEMPTS}={}){
  const frameCount=run.frame_records?.length||0,technical=run.technical_validation||null,semantic=run.semantic_validation||null,loopRequired=run.options?.loop??run.recipe_snapshot?.loop??false,loop=technical?.loop_validation||null,plans=run.repair_plans||[],latest=plans.at(-1),attempt=latest?.attempt||0;
  const exportReady=Boolean(technical?.passed&&(!loopRequired||loop?.passed)&&semantic?.passed&&!unresolvedFrames(run).some(frame=>frame.severity==='high'));
  let overallStatus;if(!frameCount)overallStatus='needs_frames';else if(!technical)overallStatus='needs_validation';else if(run.semantic_reinspection_required)overallStatus='needs_semantic_reinspection';else if(!semantic)overallStatus='needs_semantic_validation';else if(exportReady)overallStatus='passed';else if(attempt>=maxAttempts&&latest?.status==='evaluated')overallStatus='blocked';else overallStatus='needs_repair';
  return {animation_id:run.id,frame_count:frameCount,technical:technical?{score:technical.score,passed:technical.passed}:null,semantic:semantic?{score:semantic.semantic_score,passed:semantic.passed,status:'current'}:{score:null,passed:false,status:run.semantic_reinspection_required?'needs_reinspection':'missing'},loop:loop?{score:loop.loop_score,passed:loop.passed,required:loopRequired}:{score:null,passed:!loopRequired,required:loopRequired},overall_status:overallStatus,current_repair_attempt:attempt,max_repair_attempts:maxAttempts,unresolved_bad_frames:run.semantic_reinspection_required?[...(latest?.repaired_frame_indexes||[])]:unresolvedFrames(run).map(frame=>frame.frame_index),export_ready:exportReady};
}
