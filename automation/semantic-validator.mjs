import {randomUUID} from 'node:crypto';

export const semanticIssueTypes=['anatomy','leg_progression','arm_leg_coordination','pose_duplicate','pose_regression','character_identity_drift','costume_or_armor_drift','direction_flip','silhouette_jump','motion_semantics','bad_visual_loop','other'];

const normalizeIssue=(issue,maxFrameIndex)=>{
  if(!issue||typeof issue!=='object'||Array.isArray(issue))throw Error('Invalid semantic issue');
  if(!semanticIssueTypes.includes(issue.type))throw Error('Invalid semantic issue type');
  if(!['low','medium','high'].includes(issue.severity))throw Error('Invalid semantic issue severity');
  if(typeof issue.description!=='string'||!issue.description.trim()||issue.description.length>500)throw Error('Invalid semantic issue description');
  if(issue.frame_index!==undefined&&(!Number.isInteger(issue.frame_index)||issue.frame_index<0||(maxFrameIndex!==undefined&&issue.frame_index>maxFrameIndex)))throw Error('Invalid semantic issue frame index');
  return {type:issue.type,...(issue.frame_index===undefined?{}:{frame_index:issue.frame_index}),severity:issue.severity,description:issue.description.trim()};
};

const normalize=(result,{animation_id,frame_id,maxFrameIndex,source='external_manual'})=>{
  if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Invalid semantic validation result');
  if(typeof result.passed!=='boolean'||!Number.isInteger(result.score)||result.score<0||result.score>100||!Array.isArray(result.issues))throw Error('Invalid semantic validation result');
  const issues=result.issues.map(issue=>normalizeIssue(issue,maxFrameIndex));
  if(result.passed&&issues.some(issue=>issue.severity==='high'))throw Error('A passing semantic result cannot contain high-severity issues');
  return {validation_id:randomUUID(),animation_id,...(frame_id?{frame_id}:{}),provider:source,semantic_score:result.score,passed:result.passed,issues,bad_frames:[...new Set(issues.filter(issue=>issue.frame_index!==undefined).map(issue=>issue.frame_index))].sort((a,b)=>a-b),created_at:new Date().toISOString()};
};

export class VisionSupervisor {
  async validate_frame(){throw Error('Vision supervisor is not implemented');}
  async validate_animation(){throw Error('Vision supervisor is not implemented');}
}

export class ExternalManualVisionProvider extends VisionSupervisor {
  async validate_frame({animation_id,frame_id,supervisor_result}){return normalize(supervisor_result,{animation_id,frame_id});}
  async validate_animation({animation_id,max_frame_index,supervisor_result}){return normalize(supervisor_result,{animation_id,maxFrameIndex:max_frame_index});}
}

export function combineValidation(technical,semantic){
  const technicalSummary=technical?{score:technical.score,passed:Boolean(technical.passed)}:null;
  const semanticSummary=semantic?{score:semantic.semantic_score,passed:Boolean(semantic.passed)}:null;
  return {technical:technicalSummary,semantic:semanticSummary,overall_passed:Boolean(technicalSummary?.passed&&semanticSummary?.passed)};
}
