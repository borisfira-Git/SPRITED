const number = (min,max,integer=false) => ({type:integer?'integer':'number',minimum:min,maximum:max});
const text = {type:'string',minLength:1,maxLength:4096};
const mode={type:'string',enum:['body','rightFoot','right_foot']};
export const actions = {
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
  'spritesheet/build': {tool:'sprited_build_spritesheet',description:'Build a PNG sheet and JSON metadata using the editor renderer.',properties:{cols:number(1,120,true)},required:['cols']},
  'export/godot': {tool:'sprited_export_godot',description:'Write a sheet, metadata and Godot 4 SpriteFrames resource beneath the workspace.',properties:{folder:text,cols:number(1,120,true)}},
  'status': {tool:'sprited_get_status',description:'Read the active project state and manifest.',properties:{}}
};
Object.assign(actions['animation/configure'].properties,{loop:{type:'boolean'},sampling:{type:'string',enum:['uniform','smart']}});
for(const key of ['canvas_width','canvas_height','alignment','background_mode','background'])actions['spritesheet/create'].properties[key]=actions['animation/configure'].properties[key];
export function validate(action,args) {
  if(!Object.hasOwn(actions,action))throw new Error('Unknown SPRITED operation');
  const spec=actions[action];
  if(!args||Array.isArray(args)||typeof args!=='object')throw new Error('Arguments must be an object');
  for(const key of spec.required||[])if(!(key in args))throw new Error(`Missing ${key}`);
  for(const [key,value] of Object.entries(args)) {
    if(!Object.hasOwn(spec.properties,key))throw new Error(`Unknown argument: ${key}`);
    const s=spec.properties[key];
    if(s.type==='integer'?!Number.isInteger(value):typeof value!==s.type)throw new Error(`Invalid ${key}`);
    if(typeof value==='number'&&(!Number.isFinite(value)||value<s.minimum||value>s.maximum))throw new Error(`Out of range: ${key}`);
    if(typeof value==='string'&&((s.minLength&&value.length<s.minLength)||(s.maxLength&&value.length>s.maxLength)||(s.pattern&&!new RegExp(s.pattern).test(value))))throw new Error(`Invalid ${key}`);
    if(s.enum&&!s.enum.includes(value))throw new Error(`Invalid ${key}`);
  }
}
export const tools=Object.values(actions).map(s=>({name:s.tool,description:s.description,inputSchema:{type:'object',properties:s.properties,required:s.required||[],additionalProperties:false}}));
