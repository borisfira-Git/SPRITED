import {randomUUID} from 'node:crypto';

export const DEFAULT_RETENTION=Object.freeze({keep_final_spritesheet:true,keep_final_frames:false,keep_failed_frames:false,keep_contact_sheets:false,keep_preview_gifs:false,keep_experience_history:true,pinned_artifact_ids:[]});
const bool=(value,fallback)=>typeof value==='boolean'?value:fallback;
export function normalizeRetention(value={}){return {keep_final_spritesheet:bool(value.keep_final_spritesheet,true),keep_final_frames:bool(value.keep_final_frames,false),keep_failed_frames:bool(value.keep_failed_frames,false),keep_contact_sheets:bool(value.keep_contact_sheets,false),keep_preview_gifs:bool(value.keep_preview_gifs,false),keep_experience_history:bool(value.keep_experience_history,true),pinned_artifact_ids:[...new Set(Array.isArray(value.pinned_artifact_ids)?value.pinned_artifact_ids.filter(id=>typeof id==='string'&&id.length<=160):[])].slice(0,100)};}
const active=run=>['draft','queued','routing','generating','collecting_frames','processing','validating','needs_semantic_reinspection'].includes(run.status)||(run.repair_plans||[]).some(plan=>plan.status==='active')||run.semantic_reinspection_required;
const owned=(run,artifact_id,role,storage_path)=>storage_path?{artifact_id,owner_animation_id:run.id,role,storage_path}:null;

export class RetentionService {
  createCleanupManifest(finalRun,runs,settings={}){
    const retention=normalizeRetention(settings),pinned=new Set(retention.pinned_artifact_ids),entries=[],related=(runs||[]).filter(run=>run.character_profile_id===finalRun.character_profile_id&&run.animation_type===finalRun.animation_type),latestSheet=finalRun.spritesheets?.at(-1)?.id;
    const add=(artifact,keep=false)=>{if(!artifact)return;const isPinned=pinned.has(artifact.artifact_id);entries.push({...artifact,action:isPinned||keep?'retain':'delete',reason:isPinned?'pinned':keep?'retention_policy':'temporary'});};
    for(const run of related){const isFinal=run.id===finalRun.id,isObsolete=!isFinal&&(['rejected','failed'].includes(run.status)||run.approval_state==='rejected');if(!isFinal&&!isObsolete)continue;if(active(run)&&!isFinal)continue;
      for(const frame of run.frame_records||[])add(owned(run,frame.frame_id,isFinal?'final_source_frame':'failed_generation_frame',frame.storage_path),isFinal?retention.keep_final_frames:retention.keep_failed_frames);
      for(const sheet of run.contact_sheets||[])add(owned(run,sheet.contact_sheet_id,'contact_sheet',sheet.storage_path),retention.keep_contact_sheets);
      for(const preview of run.gif_previews||[])add(owned(run,preview.preview_id,'preview_gif',preview.storage_path),retention.keep_preview_gifs);
      for(const sheet of run.spritesheets||[])for(const artifact of sheet.artifacts||[]){const keep=isFinal&&sheet.id===latestSheet&&artifact.role==='final_spritesheet'&&retention.keep_final_spritesheet;add({...artifact,owner_animation_id:run.id,sheet_id:sheet.id},keep);}
    }
    return {cleanup_id:randomUUID(),animation_id:finalRun.id,status:'pending',retention,entries,temporary_artifact_count:entries.filter(item=>item.action==='delete').length,retained_artifact_count:entries.filter(item=>item.action==='retain').length,created_at:new Date().toISOString()};
  }
}
