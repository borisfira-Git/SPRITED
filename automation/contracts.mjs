const number = (min,max,integer=false) => ({type:integer?'integer':'number',minimum:min,maximum:max});
const text = {type:'string',minLength:1,maxLength:4096};
const mode={type:'string',enum:['body','rightFoot','right_foot']};
export const actions = {
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
