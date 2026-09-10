const clean=value=>typeof value==='string'?value.trim():'';
const ref=id=>id?`frame:${id}`:null;

function phaseFor(run,index,total){
  const phases=run.recipe_snapshot?.motion_template?.phases||[];
  if(!phases.length)return null;
  return phases[Math.min(phases.length-1,Math.floor(index*phases.length/Math.max(1,total)))];
}

export function prepareAssistedRequest({run,frameIndex,repairPlan=null,instruction=null}){
  if(!run||!Number.isInteger(frameIndex)||frameIndex<0)throw Error('Invalid assisted frame request');
  const total=run.options?.output_frames||run.recipe_snapshot?.default_output_frame_count||0;
  if(!Number.isInteger(total)||total<1||frameIndex>=total)throw Error('Frame index is outside the animation');
  const records=[...(run.frame_records||[])].sort((a,b)=>a.frame_index-b.frame_index),byIndex=new Map(records.map(frame=>[frame.frame_index,frame]));
  const target=repairPlan?.frames_to_repair?.find(frame=>frame.frame_index===frameIndex)||null;
  if(repairPlan&&!target)throw Error('Frame is not included in the repair plan');
  const current=target?.frame_id||byIndex.get(frameIndex)?.frame_id||null;
  const previous=target?.previous_frame_id||byIndex.get(frameIndex-1)?.frame_id||null;
  const next=target?.next_frame_id||byIndex.get(frameIndex+1)?.frame_id||null;
  const dimensions={width:run.options?.canvas_width||512,height:run.options?.canvas_height||512};
  const assets={character:`character:${run.character_profile_id}`,previous:ref(previous),current:ref(current),next:ref(next),contact_sheet:target?.contact_sheet_id?`contact-sheet:${target.contact_sheet_id}`:null};
  const direction=clean(run.options?.direction)||null,phase=phaseFor(run,frameIndex,total),reasons=target?.reasons||[],descriptions=target?.issue_descriptions||[],animationInstruction=clean(instruction)||run.recipe_snapshot?.motion_description||phase||run.animation_type;
  const preserve='Preserve the exact character identity, face, hairstyle, armor/clothing, colors, equipment, camera angle, direction, scale, framing and visual style.';
  const context=[previous?'Use the previous frame as motion context.':null,next?'Use the next frame as motion context.':null].filter(Boolean).join(' ');
  const prompt=repairPlan
    ? [`Repair frame ${frameIndex+1} of ${total} only.`,descriptions.length?`Problems detected: ${descriptions.join('; ')}.`:reasons.length?`Problems detected: ${reasons.join(', ')}.`:'Fix only the reported frame issue.',preserve,context,'Do not redesign the character or change unrelated details.',`Return one ${dimensions.width}×${dimensions.height} PNG frame only.`].filter(Boolean).join('\n\n')
    : [`Create frame ${frameIndex+1} of an ${total}-frame ${run.animation_type.replaceAll('_',' ').toLowerCase()} animation using the attached character as the exact reference.`,preserve,`Animation instruction: ${animationInstruction}.`,phase?`Motion phase: ${phase}.`:null,direction?`Direction: ${direction}.`:null,context,`Return one ${dimensions.width}×${dimensions.height} PNG character frame only${run.options?.background_mode==='key'?` on solid ${run.options.background||'#00ff00'}`:''}.`].filter(Boolean).join('\n\n');
  return {request_kind:repairPlan?'repair':'generate',provider_id:'chatgpt_assisted',animation_id:run.id,repair_plan_id:repairPlan?.repair_plan_id||null,frame_index:frameIndex,total_frame_count:total,direction,motion_phase:phase,animation_instruction:animationInstruction,character_consistency_requirements:['identity','armor_or_clothing','colors','equipment','silhouette'],framing_requirements:['camera_angle','direction','scale','full_character_framing'],prompt,asset_references:assets,required_output_dimensions:dimensions,required_format:'png'};
}
