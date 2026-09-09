/* Shared project models and provider contract. No image processing lives here. */
(() => {
  'use strict';
  const copy = value => structuredClone(value);
  const now = () => new Date().toISOString();
  const id = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
  const definitions = [
    ['IDLE','Idle',true,25,8,'body',['low_jitter','consistent_scale','smooth_loop']],
    ['HIT','Hit',false,16,8,'body',['consistent_scale','readable_recoil']],
    ['DEATH','Death',false,25,8,'body',['full_progression','final_down_pose']],
    ['ATTACK','Attack',false,25,8,'body',['anticipation','strike','recovery']],
    ['RANGE_ATTACK','Ranged attack',false,25,8,'body',['aim','release','recovery']],
    ['WALKING','Walking',true,25,8,'rightFoot',['baseline_consistency','left_right_alternation','smooth_loop']]
  ];
  const phases={IDLE:['breathing','minor weight shift','secondary motion'],HIT:['impact','recoil','recovery'],DEATH:['destabilization','collapse','final pose'],ATTACK:['anticipation','windup','strike','maximum extension','follow-through','recovery'],RANGE_ATTACK:['prepare','aim','release','recoil','recovery'],WALKING:['left contact','left down','left passing','left up','right contact','right down','right passing','right up']};
  const durations={IDLE:2,HIT:.7,DEATH:2,ATTACK:1.4,RANGE_ATTACK:1.4,WALKING:1.6};
  const recipes = definitions.map(([animation_type,display_name,loop,source,output,alignment,rules]) => ({
    id:animation_type.toLowerCase()+'-v1',animation_type,display_name,loop,
    target_duration:durations[animation_type],motion_description:phases[animation_type].join(' → '),
    motion_template:{id:animation_type.toLowerCase()+'-motion-v1',phases:phases[animation_type],left_right_convention:'Anatomical left/right, never mirror. Textual phase contract; pose trajectories not yet supplied.'},
    generation_hints:['Preserve reference identity, equipment and silhouette','Fixed camera; continuous motion before frame selection'],provider_preferences:['local_animation','agent_router','manual_video'],
    default_source_frame_count:source,default_output_frame_count:output,default_alignment_mode:alignment,
    recommended_validation_rules:rules,recommended_export_layout:{cols:Math.ceil(Math.sqrt(output))},
    configurable_options:['source_frames','output_frames','canvas_width','canvas_height','alignment','background_mode','background','start','end','cols']
  }));
  const empty = () => ({schema_version:1,character_profile:null,characters:[],jobs:[],animation_runs:[],animation_memory:{},router_mode:'auto'});
  function settings(values) {
    const s={...values};
    if(s.alignment==='right_foot')s.alignment='rightFoot';
    for(const [key,min,max] of [['source_frames',1,120],['output_frames',1,120],['canvas_width',16,4096],['canvas_height',16,4096],['cols',1,120]])
      if(!Number.isInteger(s[key])||s[key]<min||s[key]>max)throw Error(`Invalid ${key}`);
    if(s.output_frames>s.source_frames)throw Error('Output frames cannot exceed source frames');
    if(!['body','rightFoot'].includes(s.alignment))throw Error('Invalid alignment');
    if(!['key','keep'].includes(s.background_mode)||!/^#[0-9a-f]{6}$/i.test(s.background))throw Error('Invalid background settings');
    if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start||s.end>86400)throw Error('Invalid source time range');
    if(s.loop!==undefined&&typeof s.loop!=='boolean')throw Error('Loop must be true or false');
    if(s.sampling!==undefined&&!['uniform','smart'].includes(s.sampling))throw Error('Unknown sampling mode');
    return s;
  }
  function image(src) {
    if(typeof src!=='string'||src.length>12*1024*1024||!/^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/.test(src))throw Error('Reference must be an embedded PNG or WebP, at most 9 MB');
    return src;
  }
  function hydrate(value) {
    if(value==null)return empty();
    if(value.schema_version!==1||!Array.isArray(value.animation_runs)||value.animation_runs.length>50)throw Error('Unsupported character workflow format');
    const w=copy(value);
    if(w.character_profile)image(w.character_profile.reference_image);
    const ids=new Set();
    for(const r of w.animation_runs){
      if(typeof r.id!=='string'||! /^[a-zA-Z0-9_-]{1,120}$/.test(r.id)||ids.has(r.id))throw Error('Invalid animation run id');
      ids.add(r.id);settings(r.options);image(r.character_reference.reference_image);
      if(typeof r.character_profile_id!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(r.character_profile_id))throw Error('Invalid run character id');
      if(!recipes.some(p=>p.animation_type===r.animation_type))throw Error('Unknown animation recipe');
      if(r.editor_snapshot?.workflow)throw Error('Recursive run snapshot');
      if(r.editor_snapshot?.frames?.some(f=>typeof f.src!=='string'||!/^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/.test(f.src)))throw Error('Run frames must be embedded images');
      r.frame_records ||= [];if(!Array.isArray(r.frame_records)||r.frame_records.length>24)throw Error('Invalid stored frame records');
      const frameIds=new Set(),indexes=new Set();for(const f of r.frame_records){if(typeof f.frame_id!=='string'||!f.frame_id.length||frameIds.has(f.frame_id)||!Number.isInteger(f.frame_index)||f.frame_index<0||f.frame_index>23||indexes.has(f.frame_index)||f.character_id!==r.character_profile_id||f.animation_id!==r.id||!['png','webp'].includes(f.format)||![f.width,f.height].every(n=>Number.isInteger(n)&&n>0)||typeof f.created_at!=='string'||typeof f.storage_path!=='string')throw Error('Invalid stored frame record');frameIds.add(f.frame_id);indexes.add(f.frame_index);}
      if(r.editor_snapshot){
        const s=r.editor_snapshot;if(![s.canvasWidth,s.canvasHeight].every(n=>Number.isInteger(n)&&n>=16&&n<=4096)||!Array.isArray(s.frames)||s.frames.length>120)throw Error('Invalid stored run canvas or frame count');
        let pixels=0;for(const f of s.frames){if(!['x','y','scale','rotation','duration','sourceWidth','sourceHeight'].every(k=>Number.isFinite(f[k])&&Math.abs(f[k])<=1e6)||f.scale<=0||f.duration<=0||f.sourceWidth<=0||f.sourceHeight<=0)throw Error('Invalid stored frame geometry');for(const key of ['charBounds','alphaBounds'])if(!f[key]||!['x','y','w','h'].every(k=>Number.isFinite(f[key][k])))throw Error('Invalid stored frame bounds');pixels+=f.sourceWidth*f.sourceHeight;}if(pixels>32*1024*1024)throw Error('Stored run exceeds pixel budget');
      }
    }
    w.animation_memory ||= {};w.characters ||= w.character_profile?[copy(w.character_profile)]:[];w.jobs ||= [];
    if(!Array.isArray(w.characters)||w.characters.length>100||!Array.isArray(w.jobs)||w.jobs.length>200)throw Error('Library exceeds supported limits');
    for(const c of w.characters){image(c.reference_image);if(typeof c.id!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(c.id))throw Error('Invalid character id');}
    for(const j of w.jobs){if(![j.job_id,j.character_id,j.attempt_id].every(v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(v))||!recipes.some(r=>r.animation_type===j.animation_type)||!w.animation_runs.some(r=>r.id===j.attempt_id))throw Error('Invalid persisted job');if(j.output_directory!==`SPRITED_DATA/characters/${j.character_id}/animations/${j.animation_type.toLowerCase()}/${j.attempt_id}`)throw Error('Invalid scoped job output directory');}
    return w;
  }
  function setReference(w,{src,name,path='',notes=''}) {
    image(src);if(typeof name!=='string'||!name.trim()||name.length>120)throw Error('Character name is required (max 120 characters)');
    const old=w.character_profile;
    w.character_profile={id:old?.id||id(),name:name.trim(),reference_image:src,reference_image_path:path,created_at:old?.created_at||now(),updated_at:now(),notes,
      preferred_canvas_width:old?.preferred_canvas_width||256,preferred_canvas_height:old?.preferred_canvas_height||256,default_background_mode:'key',default_alignment_mode:'body'};
    w.characters ||= [];const index=w.characters.findIndex(c=>c.id===w.character_profile.id);if(index<0)w.characters.push(copy(w.character_profile));else w.characters[index]=copy(w.character_profile);
    return copy(w.character_profile);
  }
  function create(w,type) {
    if(!w.character_profile)throw Error('Set a character reference first');
    if(w.animation_runs.length>=50)throw Error('Maximum 50 animation runs per project');
    const recipe=recipes.find(r=>r.animation_type===type);if(!recipe)throw Error('Unknown animation type');
    const c=w.character_profile,key=c.id+':'+type,memory=Object.hasOwn(w.animation_memory,key)?w.animation_memory[key]:null;
    const run={id:id(),character_profile_id:c.id,character_reference:copy(c),animation_type:type,recipe_id:recipe.id,recipe_snapshot:copy(recipe),status:'draft',source_mode:'direct_frames',source_video_path:null,source_frame_paths:[],frame_records:[],
      extracted_frames_paths:[],output_frames_paths:[],sprite_sheet_path:null,godot_export_path:null,created_at:now(),updated_at:now(),warnings:[],errors:[],user_approved:false,
      router_mode:w.router_mode||'auto',selected_provider:null,provider_metadata:{},approval_state:'pending',
      options:settings({source_frames:recipe.default_source_frame_count,output_frames:recipe.default_output_frame_count,canvas_width:c.preferred_canvas_width,canvas_height:c.preferred_canvas_height,alignment:recipe.default_alignment_mode,background_mode:c.default_background_mode,background:'#00ff00',start:0,end:recipe.target_duration,loop:recipe.loop,sampling:'uniform',cols:recipe.recommended_export_layout.cols,...memory?.settings}),spritesheets:[]};
    w.animation_runs.push(run);return copy(run);
  }
  function get(w,runId){const r=w.animation_runs.find(r=>r.id===runId);if(!r)throw Error('Animation run not found');return r;}
  function configure(w,runId,options){const r=get(w,runId);const {source_mode,...values}=options;const next=settings({...r.options,...values});if(source_mode&&!['manual_video','stub','agent_router','local_animation'].includes(source_mode))throw Error('Unknown provider');r.options=next;r.source_mode=source_mode||r.source_mode;invalidate(r);r.status=r.source_video_path?'source_ready':'configured';return copy(r);}
  function invalidate(r){r.user_approved=false;r.approval_state='pending';r.validation=null;r.frame_selection=null;r.source_frame_count=0;r.editor_snapshot=null;r.extracted_frames_paths=[];r.output_frames_paths=[];r.sprite_sheet_path=null;r.godot_export_path=null;r.warnings=[];r.errors=[];r.updated_at=now();}
  function attach(w,runId,path){if(typeof path!=='string'||!path.length)throw Error('Video path is required');const r=get(w,runId);invalidate(r);r.source_video_path=path;r.source_mode='manual_video';r.status='source_ready';return copy(r);}
  function approve(w,runId){const r=get(w,runId);if(!r.editor_snapshot?.frames?.length||!['validated','exported','approved'].includes(r.status))throw Error('Receive and review animation frames before using the result');r.user_approved=true;r.approval_state='approved';r.status='approved';r.updated_at=now();const key=r.character_profile_id+':'+r.animation_type,previous=w.animation_memory[key];w.animation_memory[key]={settings:copy(r.options),provider_metadata:copy(r.provider_metadata),validation:copy(r.validation||null),successful_export_settings:r.sprite_sheet_path?{cols:r.options.cols}:previous?.successful_export_settings||null,manual_corrections:(r.editor_snapshot?.frames||[]).map(f=>({id:f.id,x:f.manualOffsetX||0,y:f.manualOffsetY||0})),approved_runs:[...new Set([...(previous?.approved_runs||[]),r.id])],updated_at:now()};return copy(r);}
  class ManualVideoProvider {
    async generateAnimation(request){if(!request.source_video_path)throw Error('Attach a local video before processing');return {video_path:request.source_video_path,frame_sequence_paths:[],metadata:{provider:'manual_video'},warnings:[]};}
  }
  class StubProvider {async generateAnimation(){throw Error('Animation generation is not implemented. Attach a local video to use the existing pipeline.');}}
  class AgentRoutedProvider {async generateAnimation(request){return {pending:true,provider_name:'agent_router',request_id:request.id,metadata:{delivery:'Pull this queued run through API/MCP; submit a workspace-local video result. No agent is automatically launched.'},warnings:[],errors:[]};}}
  class LocalAnimationProvider {async generateAnimation(){throw Error('Local animation provider is not configured: install and verify a model/workflow first.');}}
  const providers={manual_video:new ManualVideoProvider(),stub:new StubProvider(),agent_router:new AgentRoutedProvider(),local_animation:new LocalAnimationProvider()};
  function listProviders(){return [{id:'manual_video',available:true,generates:false,health:'ready',reason:'Requires supplied video'},{id:'agent_router',available:true,generates:false,health:'awaiting_agent',reason:'Pull/submit bridge available; agent connection not verified'},{id:'local_animation',available:false,generates:true,health:'not_configured'},{id:'stub',available:false,generates:false,health:'placeholder'}];}
  function route(w,runId,preference='auto') {const r=get(w,runId);if(!['auto',...Object.keys(providers)].includes(preference))throw Error('Unknown router preference');const chosen=preference==='auto'?(r.source_video_path?'manual_video':'agent_router'):preference;r.router_mode=preference;r.selected_provider=chosen;r.source_mode=chosen;r.router_decision={selected_provider:chosen,reason:chosen==='manual_video'?'An attached video is available':chosen==='agent_router'?'No verified local generator; queue for an external agent':'Explicit provider selection',fallback_chain:['agent_router','manual_video'],capabilities_verified:false};r.status=chosen==='agent_router'?'queued':r.source_video_path?'source_ready':'configured';r.updated_at=now();return copy(r.router_decision);}
  function reject(w,runId){const r=get(w,runId);r.user_approved=false;r.approval_state='rejected';r.status='rejected';r.updated_at=now();const key=r.character_profile_id+':'+r.animation_type;delete w.animation_memory[key];const previous=w.animation_runs.filter(v=>v.id!==runId&&v.character_profile_id===r.character_profile_id&&v.animation_type===r.animation_type&&v.user_approved).sort((a,b)=>a.updated_at.localeCompare(b.updated_at));for(const prior of previous)approve(w,prior.id);return copy(r);}
  function regenerate(w,runId){const old=get(w,runId);if(w.animation_runs.length>=50)throw Error('Maximum 50 runs');const r=copy(old);r.id=id();r.parent_run_id=old.id;r.created_at=now();invalidate(r);r.status='draft';r.approval_state='pending';r.source_video_path=null;r.selected_provider=null;r.router_decision=null;w.animation_runs.push(r);return copy(r);}
  function character(w,characterId){const c=w.characters.find(c=>c.id===characterId);if(!c)throw Error('Character not found');return c;}
  function job(w,jobId){const j=w.jobs.find(j=>j.job_id===jobId);if(!j)throw Error('Job not found');return j;}
  function queue(w,r,previous=null){
    if(w.jobs.length>=200)throw Error('Maximum 200 jobs');
    r.source_mode='direct_frames';r.selected_provider='external_agent';r.status='queued';r.source_video_path=null;r.source_frame_paths=[];
    const j={job_id:id(),attempt_id:r.id,character_id:r.character_profile_id,character_name:r.character_reference.name,reference_image_path:r.character_reference.reference_image_path,reference_image:r.character_reference.reference_image,
      animation_type:r.animation_type,animation_recipe:copy(r.recipe_snapshot),motion_template:copy(r.recipe_snapshot.motion_template),duration:r.options.end-r.options.start,loop:r.options.loop??r.recipe_snapshot.loop,requested_output_frames:r.options.output_frames,source_frame_target:r.options.source_frames,
      generation_constraints:['Preserve face, hairstyle, clothing, colors, weapons, accessories, proportions and silhouette','Fixed camera and view direction, full body visible, no cropping','Generate a coherent ordered frame sequence',...(r.options.loop?['Produce a complete seamless loop; do not mirror anatomical left/right']:['Include a readable final resting pose']),...(r.animation_type==='WALKING'?['Opposite leg must lead in the second half of the gait cycle']:[])],
      preferred_output_format:'frame_sequence',accepted_frame_formats:['png','webp'],output_directory:`SPRITED_DATA/characters/${r.character_profile_id}/animations/${r.animation_type.toLowerCase()}/${r.id}`,status:'QUEUED',claimed_by:null,claim_token:null,claimed_at:null,retry_count:0,created_at:now(),updated_at:now(),warnings:[],errors:[],variation_request:previous?{previous_attempt_id:previous.id,rejection_reason:previous.rejection_reason||null,instruction:'Generate a genuinely different ordered frame sequence. Do not reuse the previous frames.'}:null};
    r.job_id=j.job_id;w.jobs.push(j);return copy(j);
  }
  function library(w,action,a={}){
    if(action==='character/list')return copy(w.characters.filter(c=>!c.deleted_at).map(c=>({...c,attempt_count:w.animation_runs.filter(r=>r.character_profile_id===c.id).length})));
    if(action==='character/trash')return copy(w.characters.filter(c=>c.deleted_at));
    if(action==='character/create'){if(w.characters.length>=100)throw Error('Maximum 100 characters');const old=w.character_profile;w.character_profile=null;try{return setReference(w,{src:a.src,name:a.name,path:a.path});}catch(e){w.character_profile=old;throw e;}}
    if(action==='character/select'){const c=character(w,a.id);if(c.deleted_at)throw Error('Restore this character from Trash first');w.character_profile=copy(c);return copy(c);}
    if(action==='character/rename'){const c=character(w,a.id);if(c.deleted_at)throw Error('Restore this character first');if(typeof a.name!=='string'||!a.name.trim()||a.name.length>120)throw Error('Name must be 1–120 characters');c.name=a.name.trim();c.updated_at=now();if(w.character_profile?.id===c.id)w.character_profile.name=c.name;return copy(c);}
    if(action==='character/replace-reference'){const c=character(w,a.id);if(c.deleted_at)throw Error('Restore this character first');w.character_profile=copy(c);return setReference(w,{src:a.src,name:c.name,path:a.path});}
    if(action==='character/delete'){const c=character(w,a.id);if(a.confirm_name!==c.name)throw Error('Confirm the exact character name to move it to Trash');c.deleted_at=now();if(w.character_profile?.id===c.id)w.character_profile=null;for(const j of w.jobs.filter(j=>j.character_id===c.id&&['QUEUED','CLAIMED','GENERATING'].includes(j.status))){j.status='CANCELLED';j.claim_token=null;}return copy(c);}
    if(action==='character/restore'){const c=character(w,a.id);c.deleted_at=null;return copy(c);}
    if(action==='character/purge'){
      const c=character(w,a.id);if(!c.deleted_at||a.confirm_name!==c.name||a.confirm_delete!=='DELETE PERMANENTLY')throw Error('Permanent deletion requires a trashed character, its exact name and DELETE PERMANENTLY confirmation');
      w.characters=w.characters.filter(v=>v.id!==c.id);w.animation_runs=w.animation_runs.filter(r=>r.character_profile_id!==c.id);w.jobs=w.jobs.filter(j=>j.character_id!==c.id);for(const key of Object.keys(w.animation_memory))if(key.startsWith(c.id+':'))delete w.animation_memory[key];if(w.character_profile?.id===c.id)w.character_profile=null;return {deleted_character_id:c.id};
    }
    if(action==='jobs/create'){
      const c=character(w,a.character_id);if(c.deleted_at)throw Error('Character is in Trash');
      if(!Number.isFinite(a.duration)||a.duration<.3||a.duration>5||!Number.isInteger(a.frames)||a.frames<2||a.frames>24||typeof a.loop!=='boolean')throw Error('Use duration 0.3–5, frames 2–24 and loop true/false');
      w.character_profile=copy(c);const created=create(w,a.animation_type),r=get(w,created.id);
      r.options=settings({...r.options,start:0,end:a.duration,loop:a.loop,source_frames:Math.max(r.options.source_frames,a.frames),output_frames:a.frames,sampling:a.sampling||'uniform'});return queue(w,r);
    }
    if(action==='jobs/list')return copy(w.jobs.filter(j=>!a.status||j.status===a.status).map(({claim_token,...j})=>j));
    if(action==='jobs/get'){const {claim_token,...j}=job(w,a.id);return copy(j);}
    if(action==='jobs/claim'){const j=job(w,a.id);if(j.status!=='QUEUED')throw Error('Job is not queued (it may already be claimed)');j.status='CLAIMED';j.claimed_by=a.agent;j.claim_token=id();j.claimed_at=j.updated_at=now();return copy(j);}
    if(['jobs/release','jobs/fail','jobs/submit-result'].includes(action)){
      const j=job(w,a.id);if(!['CLAIMED','GENERATING'].includes(j.status)||!a.claim_token||j.claim_token!==a.claim_token)throw Error('A valid active claim token is required');
      const r=get(w,j.attempt_id);
      if(action==='jobs/release'){j.status='QUEUED';j.claimed_by=null;j.claimed_at=null;j.retry_count++;}
      if(action==='jobs/fail'){j.status='FAILED';j.errors=[a.error];r.status='failed';r.errors=[a.error];}
      if(action==='jobs/submit-result'){attach(w,r.id,a.path);r.selected_provider=a.provider;r.provider_metadata={agent:j.claimed_by,provider:a.provider,model:a.model||null,seed:a.seed||null,submitted_at:now(),origin:'external_agent',verified_generation:false};r.requested_duration=j.duration;j.status='RESULT_SUBMITTED';j.result_path=a.path;}
      j.claim_token=null;j.updated_at=now();return copy(j);
    }
    if(action==='attempts/redo'){const previous=get(w,a.id),newRun=regenerate(w,a.id),r=get(w,newRun.id);r.spritesheets=[];return queue(w,r,previous);}
    if(action==='attempts/list')return copy(w.animation_runs.filter(r=>!a.character_id||r.character_profile_id===a.character_id).map(({editor_snapshot,...r})=>r));
    if(action==='attempts/reject'){const r=get(w,a.id);r.rejection_reason=a.reason||'other';return reject(w,a.id);}
    throw Error('Unknown library operation');
  }
  globalThis.SpritedWorkflow={empty,hydrate,settings,image,setReference,create,get,configure,attach,approve,recipes:()=>copy(recipes),ManualVideoProvider,StubProvider,
    library,
    AgentRoutedProvider,LocalAnimationProvider,listProviders,route,reject,regenerate,
    generate:request=>{if(!Object.hasOwn(providers,request.source_mode))throw Error('Unknown provider');return providers[request.source_mode].generateAnimation(request);}};
})();
