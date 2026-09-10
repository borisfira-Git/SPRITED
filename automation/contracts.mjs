const number = (min,max,integer=false) => ({type:integer?'integer':'number',minimum:min,maximum:max});
const text = {type:'string',minLength:1,maxLength:4096};
const imageBase64={type:'string',minLength:1,maxLength:12*1024*1024};
const mode={type:'string',enum:['body','rightFoot','right_foot']};
const semanticIssue={type:'object',description:'One final visual finding; do not include hidden reasoning.',properties:{type:{type:'string',description:'Machine-readable issue category.',enum:['anatomy','leg_progression','arm_leg_coordination','pose_duplicate','pose_regression','character_identity_drift','costume_or_armor_drift','direction_flip','silhouette_jump','motion_semantics','bad_visual_loop','other']},frame_index:{...number(0,23,true),description:'Zero-based affected frame when the issue is frame-specific.'},severity:{type:'string',enum:['low','medium','high']},description:{type:'string',description:'Concise observable problem.',minLength:1,maxLength:500}},required:['type','severity','description'],additionalProperties:false};
const supervisorResult={type:'object',description:'Final structured findings from an external vision-capable agent. Submit observations only, without chain-of-thought.',properties:{passed:{type:'boolean'},score:{...number(0,100,true),description:'Overall visual quality score from 0 to 100.'},issues:{type:'array',items:semanticIssue,maxItems:100},bad_frames:{type:'array',description:'Optional zero-based indexes; must match frame-specific issues.',items:number(0,23,true),maxItems:24}},required:['passed','score','issues'],additionalProperties:false};
export const actions = {
  'agent/list-characters':{tool:'list_characters',description:'List SPRITED characters available for animation.',properties:{}},
  'agent/get-character':{tool:'get_character',description:'Get one SPRITED character and its reference image information.',properties:{id:text},required:['id']},
  'agent/generate-animation':{tool:'generate_animation',description:'Create a new direct-frame animation request.',properties:{character_id:text,animation_type:{type:'string',enum:['IDLE','HIT','DEATH','ATTACK','RANGE_ATTACK','WALKING']}},required:['character_id','animation_type']},
  'agent/redo-animation':{tool:'redo_animation',description:'Create a new empty attempt from an existing animation.',properties:{id:text},required:['id']},
  'agent/use-result':{tool:'use_result',description:'Choose a completed direct-frame attempt as the current result.',properties:{id:text},required:['id']},
  'agent/build-spritesheet':{tool:'build_spritesheet',description:'Build a PNG sprite sheet from a completed direct-frame attempt.',properties:{id:text,frames:number(2,24,true),cols:number(1,24,true)},required:['id']},
  'agent/submit-frame':{tool:'submit_frame',description:'Submit one PNG/WebP frame to an animation without exposing SPRITED storage paths.',properties:{animation_id:text,frame_index:number(0,23,true),format:{type:'string',enum:['png','webp']},image_base64:imageBase64},required:['animation_id','frame_index','format','image_base64']},
  'agent/replace-frame':{tool:'replace_frame',description:'Replace the image of an existing frame while preserving its stable frame ID and order.',properties:{animation_id:text,frame_id:text,format:{type:'string',enum:['png','webp']},image_base64:imageBase64},required:['animation_id','frame_id','format','image_base64']},
  'agent/list-frames':{tool:'list_frames',description:'List ordered frame IDs and image metadata for one animation.',properties:{animation_id:text},required:['animation_id']},
  'agent/build-gif':{tool:'build_gif',description:'Build an ordered GIF preview and return a stable SPRITED asset ID.',properties:{animation_id:text,frame_duration_ms:number(20,5000,true),loop:{type:'boolean'}},required:['animation_id']},
  'agent/validate-animation':{tool:'validate_animation',description:'Run lightweight deterministic checks for frame order, dimensions, duplicates, jumps, center and scale drift.',properties:{animation_id:text},required:['animation_id']},
  'agent/detect-bad-frames':{tool:'detect_bad_frames',description:'Return prioritized frame indexes from the latest deterministic validation.',properties:{animation_id:text},required:['animation_id']},
  'agent/validate-loop':{tool:'validate_loop',description:'Validate the deterministic last-frame to first-frame transition.',properties:{animation_id:text},required:['animation_id']},
  'agent/get-frame-asset':{tool:'get_frame_asset',description:'Retrieve one stored frame image by stable frame ID.',properties:{frame_id:text},required:['frame_id']},
  'agent/build-contact-sheet':{tool:'build_contact_sheet',description:'Build an ordered PNG contact sheet for visual inspection.',properties:{animation_id:text,columns:number(1,24,true),include_frame_numbers:{type:'boolean'}},required:['animation_id']},
  'agent/semantic-validate-frame':{tool:'semantic_validate_frame',description:'Store a structured external vision review for one frame.',properties:{frame_id:text,neighboring_frame_ids:{type:'array',items:text,maxItems:4},supervisor_result:supervisorResult},required:['frame_id','supervisor_result']},
  'agent/semantic-validate-animation':{tool:'semantic_validate_animation',description:'Submit final visual findings for the ordered animation. Use only the discoverable issue types; include frame indexes for localized problems and no hidden reasoning.',properties:{animation_id:text,supervisor_result:supervisorResult},required:['animation_id','supervisor_result']},
  'agent/get-repair-plan':{tool:'get_repair_plan',description:'Create or retrieve a targeted repair plan with stable bad/previous/next frame IDs and reference context.',properties:{animation_id:text},required:['animation_id']},
  'agent/submit-repair-frame':{tool:'submit_repair_frame',description:'Replace only one frame listed by an active repair plan with externally supplied PNG/WebP content.',properties:{repair_plan_id:text,frame_index:number(0,23,true),format:{type:'string',enum:['png','webp']},image_base64:imageBase64},required:['repair_plan_id','frame_index','format','image_base64']},
  'agent/evaluate-repair':{tool:'evaluate_repair',description:'Rebuild preview/contact sheet and rerun deterministic checks; semantic validation becomes needs_reinspection.',properties:{repair_plan_id:text},required:['repair_plan_id']},
  'agent/get-animation-status':{tool:'get_animation_status',description:'Get the current state, valid next MCP actions, repair attempts and exact export blockers.',properties:{animation_id:text},required:['animation_id']},
  'character/rename':{tool:'sprited_rename_character',description:'Rename a character without changing its reference or previous attempts.',properties:{id:text,name:{type:'string',minLength:1,maxLength:120}},required:['id','name']},
  'character/replace-reference':{tool:'sprited_replace_character_reference',description:'Replace one character reference atomically; preserve previous attempt snapshots.',properties:{id:text,path:text,name:text},required:['id','path','name']},
  'connections/status':{tool:'sprited_get_connection_status',description:'Distinguish SPRITED server readiness from a live external MCP client. Does not certify generation capability.',properties:{}},
  'connections/setup':{tool:'sprited_get_connection_setup',description:'Get this installation’s MCP entry point for manual setup.',properties:{}},
  'connections/heartbeat':{tool:'sprited_agent_heartbeat',description:'Register a live agent session; expires after 90 seconds without a heartbeat.',properties:{session_id:text,agent:text},required:['session_id','agent']},
  'connections/disconnect':{tool:'sprited_agent_disconnect',description:'Remove a disconnected agent session.',properties:{session_id:text},required:['session_id']},
  'character/create':{tool:'sprited_create_character',description:'Add a new persistent character with a managed reference.',properties:{path:text,name:text},required:['path','name']},
  'character/list':{tool:'sprited_list_characters',description:'List active characters.',properties:{}},
  'character/select':{tool:'sprited_get_character',description:'Select and get an active character.',properties:{id:text},required:['id']},
  'character/trash':{tool:'sprited_list_deleted_characters',description:'List characters in Trash.',properties:{}},
  'character/delete':{tool:'sprited_delete_character',description:'Soft-delete a character after exact-name confirmation. Retains all assets.',properties:{id:text,confirm_name:text},required:['id','confirm_name']},
  'character/restore':{tool:'sprited_restore_character',description:'Restore a character and its existing history from Trash.',properties:{id:text},required:['id']},
  'character/purge':{tool:'sprited_delete_character_permanently',description:'Permanently delete a character already in Trash and its managed assets. Requires a second explicit confirmation.',properties:{id:text,confirm_name:text,confirm_delete:{type:'string',enum:['DELETE PERMANENTLY']}},required:['id','confirm_name','confirm_delete']},
  'jobs/create':{tool:'sprited_create_generation_job',description:'Queue a self-contained agent job. Does not claim generation or create a sprite sheet.',properties:{character_id:text,animation_type:{type:'string',enum:['IDLE','HIT','DEATH','ATTACK','RANGE_ATTACK','WALKING']},duration:number(.3,5),loop:{type:'boolean'},frames:number(2,24,true),sampling:{type:'string',enum:['uniform','smart']}},required:['character_id','animation_type','duration','loop','frames']},
  'jobs/list':{tool:'sprited_list_generation_jobs',description:'Discover durable generation jobs; optionally filter status.',properties:{status:text}},
  'jobs/get':{tool:'sprited_get_generation_job',description:'Get a self-contained request, motion phases, constraints and scoped output directory.',properties:{id:text},required:['id']},
  'jobs/claim':{tool:'sprited_claim_generation_job',description:'Atomically claim a queued job. Retain the returned claim token for release, fail or submit.',properties:{id:text,agent:text},required:['id','agent']},
  'jobs/release':{tool:'sprited_release_generation_job',description:'Release your claim so a job can be retried.',properties:{id:text,claim_token:text},required:['id','claim_token']},
  'jobs/fail':{tool:'sprited_fail_generation_job',description:'Record a failed generation without inventing a result.',properties:{id:text,claim_token:text,error:text},required:['id','claim_token','error']},
  'jobs/submit-result':{tool:'sprited_submit_job_result',description:'Submit a real local video for a claimed job. Copies it into durable character storage; no extraction yet.',properties:{id:text,claim_token:text,path:text,provider:text,model:text,seed:text},required:['id','claim_token','path','provider']},
  'attempts/list':{tool:'sprited_list_animation_attempts',description:'List attempts and separately derived sheets.',properties:{character_id:text}},
  'attempts/redo':{tool:'sprited_redo_animation',description:'Queue a genuinely new generation attempt, preserving the previous video and settings.',properties:{id:text},required:['id']},
  'attempts/reject':{tool:'sprited_reject_animation_attempt',description:'Reject an attempt with a reason while preserving history.',properties:{id:text,reason:text},required:['id']},
  'spritesheet/create':{tool:'sprited_create_spritesheet_from_attempt',description:'Create exactly 2–24 frames from a stored video through the existing pipeline. SMART currently reports uniform fallback.',properties:{id:text,frames:number(2,24,true),sampling:{type:'string',enum:['uniform','smart']},cols:number(1,24,true)},required:['id','frames']},
  'diagnostics/status':{tool:'sprited_get_generation_readiness',description:'Read CPU/RAM, runtime and local ComfyUI readiness. Does not download models.',properties:{}},
  'animation/export-godot':{tool:'sprited_export_animation_run_godot',description:'Export a stored run through the existing PNG and Godot exporter, preserving the active editor.',properties:{id:text,cols:number(1,120,true)},required:['id']},
  'character/set-reference':{tool:'sprited_set_character_reference',description:'Store a permanent workspace-local PNG/WebP character reference.',properties:{path:text,name:{type:'string',minLength:1,maxLength:120}},required:['path','name']},
  'character/show':{tool:'sprited_get_character_reference',description:'Get the canonical character reference.',properties:{}},
  'recipes/list':{tool:'sprited_list_animation_recipes',description:'List the six recipes and reusable motion phase templates.',properties:{}},
  'providers/list':{tool:'sprited_list_providers',description:'Provider availability; queued agent work is not generation success.',properties:{}},
  'router/status':{tool:'sprited_get_router_status',description:'Read router and provider readiness.',properties:{}},
  'animation/create':{tool:'sprited_create_generation_request',description:'Create a run using the character reference, recipe and approved settings.',properties:{animation_type:{type:'string',enum:['IDLE','HIT','DEATH','ATTACK','RANGE_ATTACK','WALKING']}},required:['animation_type']},
  'animation/list':{tool:'sprited_list_animation_runs',description:'List runs, including queued requests for an external agent to collect.',properties:{}},
  'animation/status':{tool:'sprited_get_generation_status',description:'Get a run, recipe, reference and router decision.',properties:{id:text},required:['id']},
  'animation/configure':{tool:'sprited_configure_animation_run',description:'Configure a run. Invalidates prior processing and approval.',properties:{id:text,source_frames:number(1,120,true),output_frames:number(1,120,true),canvas_width:number(16,4096,true),canvas_height:number(16,4096,true),alignment:mode,background_mode:{type:'string',enum:['key','keep']},background:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},start:number(0,86400),end:number(0,86400),cols:number(1,120,true),source_mode:{type:'string',enum:['manual_video','agent_router','local_animation','stub']}},required:['id']},
  'animation/attach-video':{tool:'sprited_attach_video_to_run',description:'Attach a workspace-local source video without claiming AI generation.',properties:{id:text,path:text},required:['id','path']},
  'animation/route':{tool:'sprited_route_generation',description:'Choose an available source route. AUTO queues an external-agent request when no video is attached.',properties:{id:text,provider:{type:'string',enum:['auto','manual_video','agent_router','local_animation','stub']}},required:['id']},
  'animation/submit-result':{tool:'sprited_submit_generation_result',description:'Submit a generated workspace-local video for a queued run. Then call process.',properties:{id:text,path:text,provider:text},required:['id','path','provider']},
  'animation/process':{tool:'sprited_process_generation',description:'Process a supplied video through the existing pipeline. Missing generators fail explicitly.',properties:{id:text},required:['id']},
  'animation/open':{tool:'sprited_open_animation_run',description:'Open processed run frames in the current editor for preview/export.',properties:{id:text},required:['id']},
  'animation/approve':{tool:'sprited_approve_animation',description:'Approve a processed result and remember settings. This is a human/agent quality decision.',properties:{id:text},required:['id']},
  'animation/reject':{tool:'sprited_reject_animation',description:'Reject a run while preserving its history.',properties:{id:text},required:['id']},
  'animation/regenerate':{tool:'sprited_regenerate_animation',description:'Create a new attempt preserving the old run and its reference.',properties:{id:text},required:['id']},
  'project/open': {tool:'sprited_open_project',description:'Open a .spriteproject or animation manifest within the configured workspace.',properties:{path:text},required:['path']},
  'video/import': {tool:'sprited_import_video',description:'Select a local source video within the workspace; does not generate video.',properties:{path:text},required:['path']},
  'video/extract': {tool:'sprited_extract_frames',description:'Append evenly spaced frames from the selected video, excluding the end timestamp.',properties:{start:number(0,86400),end:number(0,86400),frames:number(1,120,true),max_size:number(64,1024,true)},required:['start','end','frames']},
  'frames/get': {tool:'sprited_get_frames',description:'Get frame geometry, durations, source timestamps and alignment state.',properties:{}},
  'frames/align': {tool:'sprited_align_frames',description:'Run the existing editor body or right-foot alignment.',properties:{mode}},
  'frames/normalize': {tool:'sprited_normalize_frames',description:'Apply the existing shared-scale normalization to the canvas ruler and ground guides, preserving manual offsets.',properties:{mode}},
  'frames/remove-background': {tool:'sprited_remove_background',description:'Apply the editor chroma-key removal. Intended for solid backgrounds.',properties:{color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},tolerance:number(0,442),softness:number(0,80)}},
  'animation/validate': {tool:'sprited_validate_animation',description:'Check empty frames, scale, baseline and clipping; not semantic motion quality.',properties:{}},
  'animation/preview': {tool:'sprited_preview_animation',description:'Write a standalone local HTML animation preview in the output directory.',properties:{}},
  'spritesheet/build': {tool:'sprited_build_spritesheet',description:'Build a PNG sheet and JSON metadata using the editor renderer.',properties:{folder:text,cols:number(1,120,true)},required:['cols']},
  'export/godot': {tool:'sprited_export_godot',description:'Write a sheet, metadata and Godot 4 SpriteFrames resource beneath the workspace.',properties:{folder:text,cols:number(1,120,true)}},
  'status': {tool:'sprited_get_status',description:'Read the active project state and manifest.',properties:{}}
};
Object.assign(actions['animation/configure'].properties,{loop:{type:'boolean'},sampling:{type:'string',enum:['uniform','smart']}});
for(const key of ['canvas_width','canvas_height','alignment','background_mode','background'])actions['spritesheet/create'].properties[key]=actions['animation/configure'].properties[key];
function validateValue(value,s,label){
  if(s.type==='array'){
    if(!Array.isArray(value)||(s.minItems&&value.length<s.minItems)||(s.maxItems&&value.length>s.maxItems))throw new Error(`Invalid ${label}`);
    value.forEach((item,index)=>validateValue(item,s.items,`${label}[${index}]`));return;
  }
  if(s.type==='object'){
    if(!value||Array.isArray(value)||typeof value!=='object')throw new Error(`Invalid ${label}`);
    for(const key of s.required||[])if(!(key in value))throw new Error(`Missing ${label}.${key}`);
    for(const [key,item] of Object.entries(value)){if(s.additionalProperties===false&&!Object.hasOwn(s.properties,key))throw new Error(`Unknown argument: ${label}.${key}`);if(s.properties?.[key])validateValue(item,s.properties[key],`${label}.${key}`);}return;
  }
  if(s.type==='integer'?!Number.isInteger(value):typeof value!==s.type)throw new Error(`Invalid ${label}`);
  if(typeof value==='number'&&(!Number.isFinite(value)||value<s.minimum||value>s.maximum))throw new Error(`Out of range: ${label}`);
  if(typeof value==='string'&&((s.minLength&&value.length<s.minLength)||(s.maxLength&&value.length>s.maxLength)||(s.pattern&&!new RegExp(s.pattern).test(value))))throw new Error(`Invalid ${label}`);
  if(s.enum&&!s.enum.includes(value))throw new Error(`Invalid ${label}`);
}
export function validate(action,args) {
  if(!Object.hasOwn(actions,action))throw new Error('Unknown SPRITED operation');
  const spec=actions[action];
  if(!args||Array.isArray(args)||typeof args!=='object')throw new Error('Arguments must be an object');
  for(const key of spec.required||[])if(!(key in args))throw new Error(`Missing ${key}`);
  for(const [key,value] of Object.entries(args)) {
    if(!Object.hasOwn(spec.properties,key))throw new Error(`Unknown argument: ${key}`);
    validateValue(value,spec.properties[key],key);
  }
}
export const mcpActions=Object.fromEntries(Object.entries(actions).filter(([key])=>key.startsWith('agent/')));
export const tools=Object.values(mcpActions).map(s=>({name:s.tool,description:s.description,inputSchema:{type:'object',properties:s.properties,required:s.required||[],additionalProperties:false}}));
