import {readFile,writeFile,rename,mkdir,realpath,stat,unlink,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {validate} from './contracts.mjs';
import {diagnostics} from './diagnostics.mjs';
import {Connections} from './connections.mjs';
import {acquireLock,releaseLock} from './lock.mjs';
import {ExternalManualProvider} from './image-provider.mjs';
const appRoot=fileURLToPath(new URL('../',import.meta.url));
export const envelope=(result={},warnings=[],output_paths=[])=>({success:true,status:'ok',result,warnings,errors:[],output_paths,next_suggested_action:null});
export const failure=error=>({success:false,status:'failed',result:null,warnings:[],errors:[error.message||String(error)],output_paths:[],next_suggested_action:null});
const compactAgentResult=value=>{
  if(Array.isArray(value))return value.map(compactAgentResult);
  const result=structuredClone(value);delete result.reference_image;
  if(result.character_reference)delete result.character_reference.reference_image;
  return result;
};
export class Service {
  constructor(root){this.root=path.resolve(root);this.tail=Promise.resolve();this.imageProviders={external_manual:new ExternalManualProvider()};this.manifest={version:1,character:'Character',animation:'animation',source_video:null,target_frames:24,background:'#00ff00',alignment:'body',frame_size:[512,512]};}
  async init(){
    this.root=await realpath(this.root);
    this.stateDir=await this.directory('.sprited');
    this.lockPath=path.join(this.stateDir,'automation.lock');
    this.lockContents=await acquireLock(this.lockPath,this.root);this.ownsLock=true;
    let module;try {module=await import('playwright-core');}catch(error){if(!process.env.SPRITED_PLAYWRIGHT)throw new Error('Run npm install in automation/ before using agents.');module=await import(pathToFileURL(process.env.SPRITED_PLAYWRIGHT).href);}
    this.browser=await module.chromium.launch({channel:'msedge',headless:true});
    this.page=await this.browser.newPage();
    const source=existsSync(path.join(appRoot,'static/index.html'));
    const assets={'/':[source?'static/index.html':'app/index.html','text/html'],'/style.css':[source?'app/globals.css':'app/style.css','text/css'],'/app.js':[source?'static/app.js':'app/app.js','text/javascript'],'/video-import.js':[source?'public/video-import.js':'app/video-import.js','text/javascript'],'/og.png':[source?'public/og.png':'app/og.png','image/png']};
    for(const name of ['character-workflow','character-panel','editor-bridge'])assets[`/${name}.js`]=[`${source?'public':'app'}/${name}.js`,'text/javascript'];
    await this.page.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.origin!=='http://sprited.local')return route.abort();
      if(u.pathname==='/source-video'&&this.videoPath) {
        const bytes=await readFile(this.videoPath),range=route.request().headers().range;
        const match=range?.match(/^bytes=(\d+)-(\d*)$/);
        const start=match?Number(match[1]):0,end=match&&match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1;
        if(start>end)return route.fulfill({status:416,body:''});
        const headers={'accept-ranges':'bytes','content-type':path.extname(this.videoPath).toLowerCase()==='.webm'?'video/webm':'video/mp4'};
        if(match)headers['content-range']=`bytes ${start}-${end}/${bytes.length}`;
        return route.fulfill({status:match?206:200,headers,body:bytes.subarray(start,end+1)});
      }
      const asset=assets[u.pathname];if(!asset)return route.fulfill({status:404,body:''});
      return route.fulfill({contentType:asset[1],body:await readFile(path.join(appRoot,asset[0]))});
    });
    await this.page.goto('http://sprited.local/');
    try {
      const session=JSON.parse(await readFile(await this.input('.sprited/session.json',['.json'],110*1024*1024),'utf8'));
      await this.openProject(session.project);this.manifest={...this.manifest,...this.safeManifest(session.manifest)};
      if(this.manifest.source_video)this.videoPath=await this.input(this.manifest.source_video,['.mp4','.webm','.mov'],250*1024*1024);
    }catch(error){if(error.code!=='ENOENT')throw error;}
    return this;
  }
  contained(target){const rel=path.relative(this.root,target);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw new Error('Path is outside the configured workspace');return target;}
  async input(value,extensions,max){const target=this.contained(await realpath(this.contained(path.resolve(this.root,value))));if(!extensions.includes(path.extname(target).toLowerCase()))throw new Error('Unsupported file type');const info=await stat(target);if(!info.isFile()||info.size>max)throw new Error('File is too large or is not a regular file');return target;}
  async directory(value){
    const target=this.contained(path.resolve(this.root,value));let current=this.root;
    for(const segment of path.relative(this.root,target).split(path.sep).filter(Boolean)){
      current=path.join(current,segment);try {current=this.contained(await realpath(current));}catch(e){if(e.code!=='ENOENT')throw e;await mkdir(current);current=this.contained(await realpath(current));}
    }return current;
  }
  safeManifest(m){
    if(!m||typeof m!=='object')throw new Error('Invalid manifest');
    const result={};for(const key of ['character','animation','source_video','target_frames','background','alignment','frame_size'])if(key in m)result[key]=m[key];
    for(const key of ['character','animation'])if(key in result&&(typeof result[key]!=='string'||result[key].length>120))throw new Error(`Invalid manifest ${key}`);
    if(result.source_video!=null&&typeof result.source_video!=='string')throw new Error('Invalid source_video');
    if(result.target_frames!=null&&(!Number.isInteger(result.target_frames)||result.target_frames<1||result.target_frames>120))throw new Error('Invalid target_frames');
    if(result.background&&!/^#[0-9a-f]{6}$/i.test(result.background))throw new Error('Invalid background');
    if(result.alignment&&!['body','rightFoot','right_foot'].includes(result.alignment))throw new Error('Invalid alignment');
    if(result.frame_size&&(!Array.isArray(result.frame_size)||result.frame_size.length!==2||result.frame_size.some(n=>!Number.isInteger(n)||n<16||n>4096)))throw new Error('Invalid frame_size');
    return result;
  }
  async core(operation,args={}){return this.page.evaluate(({operation,args})=>window.SpritedCore.dispatch(operation,args),{operation,args});}
  async openProject(data){
    if(!data||data.version!==1||!Array.isArray(data.frames)||data.frames.length>120)throw new Error('Invalid project format or more than 120 frames');
    if(![data.canvasWidth,data.canvasHeight].every(n=>Number.isInteger(n)&&n>=16&&n<=4096))throw new Error('Invalid canvas dimensions');
    let pixels=0;
    for(const f of data.frames){
      if(typeof f.id!=='string'||! /^[a-zA-Z0-9_-]{1,120}$/.test(f.id))throw new Error('Invalid frame id');
      if(typeof f.src!=='string'||!/^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/.test(f.src))throw new Error('Projects may only contain embedded PNG/WebP frames');
      for(const key of ['x','y','scale','rotation','duration','sourceWidth','sourceHeight'])if(!Number.isFinite(f[key])||Math.abs(f[key])>1e6)throw new Error(`Invalid frame ${key}`);
      if(f.scale<=0||f.duration<=0)throw new Error('Invalid scale or duration');
      for(const key of ['charBounds','alphaBounds'])if(!f[key]||!['x','y','w','h'].every(k=>Number.isFinite(f[key][k])))throw new Error('Invalid frame bounds');
      pixels+=f.sourceWidth*f.sourceHeight;
    }
    if(pixels>32*1024*1024)throw new Error('Project exceeds the automation pixel budget');
    const safe={};for(const key of ['version','projectName','frames','selectedId','selectedIds','selectionAnchorId','referenceId','canvasWidth','canvasHeight','groundRatio','anchorRatio','targetHeightRatio','rulerBottomRatio','alignmentMode','fps','loop'])if(key in data)safe[key]=data[key];
    if(data.workflow)safe.workflow=data.workflow;
    await this.core('open',{project:safe});
  }
  async persist(){
    const project=await this.core('snapshot');
    const target=path.join(this.stateDir,'session.json');
    // Validate existing destination too; never follow a replacement symlink.
    try {this.contained(await realpath(target));}catch(e){if(e.code!=='ENOENT')throw e;}
    const temp=path.join(this.stateDir,`${randomUUID()}.tmp`);
    await writeFile(temp,JSON.stringify({manifest:this.manifest,project}),{flag:'wx'});await rename(temp,target);
  }
  async storeExternalFrame(args,replace=false){
    const run=await this.core('workflow/animation/status',{id:args.animation_id}),records=run.frame_records||[],previous=replace?records.find(frame=>frame.frame_id===args.frame_id):null;
    if(replace&&!previous)throw Error('Frame not found');
    const normalized=await this.imageProviders.external_manual[replace?'edit_frame':'generate_frame'](args),src=`data:${normalized.mime_type};base64,${normalized.bytes.toString('base64')}`;
    const dimensions=await this.page.evaluate(source=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve({width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>reject(Error('Image could not be decoded'));image.src=source;}),src);
    if(dimensions.width*dimensions.height>4*1024*1024)throw Error('Frame exceeds 4 megapixels');
    const frameId=previous?.frame_id||randomUUID(),createdAt=previous?.created_at||new Date().toISOString(),dir=await this.directory(`SPRITED_DATA/characters/${run.character_profile_id}/animations/${run.animation_type.toLowerCase()}/${run.id}/frames`),target=path.join(dir,`${frameId}-${randomUUID()}.${normalized.format}`);
    await writeFile(target,normalized.bytes,{flag:'wx'});
    const record={frame_id:frameId,character_id:run.character_profile_id,animation_id:run.id,frame_index:previous?.frame_index??args.frame_index,format:normalized.format,width:dimensions.width,height:dimensions.height,created_at:createdAt,storage_path:path.relative(this.root,target)};
    let result;try{result=await this.core('workflow/animation/store-frame',{id:run.id,record,replace});await this.persist();}catch(error){await unlink(target).catch(()=>{});throw error;}
    if(previous?.storage_path&&previous.storage_path!==record.storage_path){const old=await this.input(previous.storage_path,['.png','.webp'],9*1024*1024).catch(()=>null);if(old)await unlink(old).catch(()=>{});}
    return result;
  }
  async materializeStoredFrames(id){
    const run=await this.core('workflow/animation/status',{id}),records=(run.frame_records||[]).toSorted((a,b)=>a.frame_index-b.frame_index);
    if(records.length<2)throw Error('Submit at least two frames before building a sprite sheet');
    if(records.some((frame,index)=>frame.frame_index!==index))throw Error('Frame indexes must be contiguous and start at 0');
    const frames=[];for(const record of records){const file=await this.input(record.storage_path,['.png','.webp'],9*1024*1024),bytes=await readFile(file);frames.push({path:record.storage_path,name:`Frame ${String(record.frame_index+1).padStart(2,'0')}`,src:`data:image/${record.format};base64,${bytes.toString('base64')}`});}
    return this.core('workflow/animation/attach-frames',{id,frames,provider:'external_manual'});
  }
  call(action,args={}){const run=this.tail.then(()=>this.execute(action,args));this.tail=run.catch(()=>{});return run;}
  async execute(action,args){
    let before,oldManifest,oldVideo;
    try {
      validate(action,args);
      if(action.startsWith('connections/')){this.connections ||= new Connections();if(action==='connections/setup')return envelope({command:process.execPath,cli_path:path.join(appRoot,'automation','cli.mjs'),transport:'stdio via authenticated localhost API',instructions:'Start this library, configure the MCP client manually, then return and press TEST CONNECTION. A connection does not verify a generation tool.'});return envelope(this.connections[action.split('/')[1]](args));}
      before=await this.core('snapshot');oldManifest=structuredClone(this.manifest);oldVideo=this.videoPath;
      let result,outputs=[];
      const mode=(args.mode||this.manifest.alignment)==='right_foot'?'rightFoot':args.mode||this.manifest.alignment;
      if(action==='agent/list-characters')return envelope(compactAgentResult(await this.core('workflow/character/list')));
      if(action==='agent/get-character')return envelope(compactAgentResult(await this.core('workflow/character/select',{id:args.id})));
      if(action==='agent/generate-animation'){
        const recipes=await this.core('workflow/recipes/list'),recipe=recipes.find(r=>r.animation_type===args.animation_type);if(!recipe)throw Error('Unknown animation type');
        const job=await this.core('workflow/jobs/create',{character_id:args.character_id,animation_type:args.animation_type,duration:recipe.target_duration,loop:recipe.loop,frames:recipe.default_output_frame_count,sampling:'uniform'});await this.directory(job.output_directory);await writeFile(path.join(this.root,job.output_directory,'job.json'),JSON.stringify(job,null,2),{flag:'wx'});await this.persist();return {...envelope(compactAgentResult(job)),status:'queued',next_suggested_action:'Create ordered PNG/WebP images and call submit_frame for each frame.'};
      }
      if(action==='agent/redo-animation'){
        const job=await this.core('workflow/attempts/redo',{id:args.id});await this.directory(job.output_directory);await writeFile(path.join(this.root,job.output_directory,'job.json'),JSON.stringify(job,null,2),{flag:'wx'});
        await this.persist();return {...envelope(compactAgentResult(job)),status:'queued',next_suggested_action:'Call submit_frame for each replacement frame.'};
      }
      if(action==='agent/use-result'){result=await this.core('workflow/animation/approve',{id:args.id});await this.persist();return {...envelope(compactAgentResult(result),result.warnings||[]),status:'approved',next_suggested_action:'Call build_spritesheet.'};}
      if(action==='agent/submit-frame'){result=await this.storeExternalFrame(args,false);return {...envelope(result),status:'stored',next_suggested_action:'Submit the next frame or call list_frames.'};}
      if(action==='agent/replace-frame'){result=await this.storeExternalFrame(args,true);return {...envelope(result),status:'replaced',next_suggested_action:'Call list_frames to verify the sequence.'};}
      if(action==='agent/list-frames')return envelope(await this.core('workflow/animation/list-frames',{id:args.animation_id}));
      if(action==='agent/build-spritesheet'){let run=await this.core('workflow/animation/status',{id:args.id});if(run.frame_records?.length&&run.source_frame_paths?.length!==run.frame_records.length){await this.materializeStoredFrames(args.id);await this.persist();run=await this.core('workflow/animation/status',{id:args.id});}const built=await this.execute('spritesheet/create',{id:args.id,frames:args.frames||run.source_frame_paths?.length,cols:args.cols});if(built.result)built.result=compactAgentResult(built.result);return built;}
      if(action==='diagnostics/status')return envelope(await diagnostics(this.root));
      if(action==='character/purge'){
        const c=before.workflow?.characters.find(c=>c.id===args.id);if(!c)throw Error('Character not found');
        const managed=this.contained(path.join(this.root,'SPRITED_DATA','characters',c.id));
        try{const resolved=this.contained(await realpath(managed));if(path.relative(managed,resolved)!=='')throw Error('Refusing to delete a redirected character directory');}catch(e){if(e.code!=='ENOENT')throw e;}
        const refs=new Set([c.reference_image_path,...before.workflow.animation_runs.filter(r=>r.character_profile_id===c.id).map(r=>r.character_reference.reference_image_path)]);
        for(const other of before.workflow.characters.filter(v=>v.id!==c.id))refs.delete(other.reference_image_path);
        for(const other of before.workflow.animation_runs.filter(v=>v.character_profile_id!==c.id))refs.delete(other.character_reference.reference_image_path);
        const files=[];for(const ref of refs)if(/^\.sprited[\\/]references[\\/][a-zA-Z0-9-]+\.(png|webp)$/.test(ref||'')){try{files.push(await this.input(ref,['.png','.webp'],9*1024*1024));}catch(e){if(e.code!=='ENOENT')throw e;}}
        const deleted=await this.core('workflow/character/purge',args);await this.persist();
        const warnings=[];for(const target of [managed,...files]){try{await rm(target,{recursive:target===managed,force:true});}catch(e){warnings.push(`Cleanup pending for ${target}: ${e.message}`);}}
        if(warnings.length)await writeFile(path.join(this.stateDir,'pending-delete-'+randomUUID()+'.json'),JSON.stringify({character_id:c.id,targets:[managed,...files],warnings}),{flag:'wx'});
        return envelope(deleted,warnings);
      }
      if(action==='spritesheet/create'){
        const run=await this.core('workflow/animation/status',{id:args.id});if(!run.source_video_path&&!run.source_frame_paths?.length)throw Error('Receive animation frames first');
        const processing={};for(const key of ['canvas_width','canvas_height','alignment','background_mode','background'])if(key in args)processing[key]=args[key];
        let processed={warnings:run.warnings||[]},processedState;
        if(run.source_frame_paths?.length){await this.core('workflow/animation/open',{id:args.id});await this.core('select-frames',{count:args.frames||run.source_frame_paths.length});processedState=await this.core('snapshot');}
        else {
          this.videoPath=await this.input(run.source_video_path,['.mp4','.webm','.mov'],250*1024*1024);
          await this.core('workflow/animation/configure',{id:args.id,output_frames:args.frames,source_frames:Math.max(run.options.source_frames,args.frames),sampling:args.sampling||'uniform',...processing});
          processed=await this.core('workflow/animation/process',{id:args.id,url:'http://sprited.local/source-video?'+randomUUID(),exact_output:true});if(processed.status==='failed')throw Error(processed.errors.join('; '));processedState=await this.core('snapshot');await this.core('workflow/animation/open',{id:args.id});
        }
        const folder=`SPRITED_DATA/characters/${run.character_profile_id}/animations/${run.animation_type.toLowerCase()}/${run.id}/spritesheets`;
        const exported=await this.execute(run.source_frame_paths?.length?'spritesheet/build':'export/godot',{folder,cols:args.cols||run.options.cols});
        if(!exported.success)throw Error(exported.errors.join('; '));
        const preview=await this.core('preview'),dir=path.dirname(exported.output_paths[0]);
        for(let i=0;i<preview.frames.length;i++){const file=path.join(dir,`frame_${String(i).padStart(3,'0')}.png`);await writeFile(file,Buffer.from(preview.frames[i].src.split(',')[1],'base64'),{flag:'wx'});exported.output_paths.push(file);}
        await this.core('open',{project:processedState});
        const saved=await this.core('workflow/animation/record-sheet',{id:args.id,sheet_id:randomUUID(),frames:args.frames,sampling:args.sampling||'uniform',paths:exported.output_paths,approved:run.user_approved,approval_state:run.approval_state});await this.persist();
        return {...envelope(saved,processed.warnings||[],exported.output_paths),status:'ready'};
      }
      if(action==='animation/export-godot'){
        const run=await this.core('workflow/animation/status',{id:args.id});
        await this.core('workflow/animation/open',{id:args.id});
        this.manifest.animation=run.character_reference.name+'_'+run.animation_type.toLowerCase();
        const exported=await this.execute('export/godot',{cols:args.cols||run.options.cols});
        await this.core('open',{project:before});this.manifest=oldManifest;
        if(!exported.success)return exported;
        await this.core('workflow/animation/record-export',{id:args.id,paths:exported.output_paths});await this.persist();return exported;
      }
      if(action.startsWith('character/')||action.startsWith('jobs/')||action.startsWith('attempts/')||['recipes/list','providers/list','router/status','animation/create','animation/list','animation/status','animation/configure','animation/attach-video','animation/route','animation/submit-result','animation/process','animation/open','animation/approve','animation/reject','animation/regenerate'].includes(action)){
        const internal={...args};
        let operation=action;
        if(['character/set-reference','character/create','character/replace-reference'].includes(action)){
          const file=await this.input(args.path,['.png','.webp'],9*1024*1024),bytes=await readFile(file);
          internal.src=`data:image/${path.extname(file).slice(1).toLowerCase()};base64,${bytes.toString('base64')}`;
          const dir=await this.directory('.sprited/references');internal.path=path.relative(this.root,path.join(dir,randomUUID()+path.extname(file).toLowerCase()));
        }
        if(action==='jobs/submit-result'){
          const job=await this.core('workflow/jobs/get',{id:args.id});
          if(!['CLAIMED','GENERATING'].includes(job.status))throw Error('Job is not claimed');
          const file=await this.input(args.path,['.mp4','.webm','.mov'],250*1024*1024);
          const dir=await this.directory(job.output_directory),target=path.join(dir,'generation-'+randomUUID()+path.extname(file).toLowerCase());
          internal.path=path.relative(this.root,target);
          // Claim validation happens before copying untrusted submission bytes.
          result=await this.core('workflow/'+operation,internal);
          await writeFile(target,await readFile(file),{flag:'wx'});
          await writeFile(path.join(dir,'generation-'+randomUUID()+'.json'),JSON.stringify({...result,claim_token:undefined},null,2),{flag:'wx'});
          await this.persist();return {...envelope(result,[],[target]),status:'RESULT_SUBMITTED',next_suggested_action:'Preview video, approve/reject or REDO. Create a sprite sheet separately.'};
        }
        if(['animation/attach-video','animation/submit-result'].includes(action)){
          const file=await this.input(args.path,['.mp4','.webm','.mov'],250*1024*1024);internal.path=path.relative(this.root,file);
          if(action==='animation/submit-result'){
            const run=await this.core('workflow/animation/status',{id:args.id});if(run.status!=='queued')throw Error('Results can only be submitted to a queued request');
          }
          operation=action;
        }
        if(action==='animation/process'){
          const run=await this.core('workflow/animation/status',{id:args.id});
          if(run.source_mode==='manual_video'&&run.source_video_path){this.videoPath=await this.input(run.source_video_path,['.mp4','.webm','.mov'],250*1024*1024);internal.url='http://sprited.local/source-video?'+randomUUID();}
        }
        result=await this.core('workflow/'+operation,internal);
        if(['character/set-reference','character/create','character/replace-reference'].includes(action))await writeFile(path.join(this.root,internal.path),Buffer.from(internal.src.split(',')[1],'base64'),{flag:'wx'});
        if(['jobs/create','attempts/redo'].includes(action)){const dir=await this.directory(result.output_directory);await writeFile(path.join(dir,'job.json'),JSON.stringify(result,null,2),{flag:'wx'});}
        if(action.startsWith('jobs/')||action==='attempts/redo'){
          const withWorkspace=j=>({...j,workspace_root:this.root});result=Array.isArray(result)?result.map(withWorkspace):withWorkspace(result);
        }
        await this.persist();
        if(action==='animation/process'&&result?.status==='failed')return {...failure(new Error(result.errors.join('; '))),result,status:'failed'};
        return {...envelope(result,result?.warnings||[],outputs),status:result?.status||'ok',provider:result?.selected_provider||null,next_suggested_action:result?.status==='queued'?'External agent: collect this request, generate source, then submit-result':result?.status==='validated'?'Review, approve, open and export':null};
      } else if(action==='project/open'){
        const file=await this.input(args.path,['.json','.spriteproject'],110*1024*1024),data=JSON.parse(await readFile(file,'utf8'));
        if(Array.isArray(data.frames)) {await this.openProject(data);this.manifest={...this.manifest,animation:data.projectName,source_video:null,frame_size:[data.canvasWidth,data.canvasHeight],alignment:data.alignmentMode||'body'};this.videoPath=null;}
        else {
          this.manifest={...this.manifest,...this.safeManifest(data)};
          if(data.project_file){const project=await this.input(path.resolve(path.dirname(file),data.project_file),['.spriteproject'],110*1024*1024);await this.openProject(JSON.parse(await readFile(project,'utf8')));}
          else {await this.openProject({version:1,projectName:this.manifest.animation,frames:[],selectedId:null,referenceId:null,canvasWidth:this.manifest.frame_size[0],canvasHeight:this.manifest.frame_size[1],fps:12,loop:true,groundRatio:.88,alignmentMode:this.manifest.alignment==='right_foot'?'rightFoot':this.manifest.alignment});}
          this.videoPath=this.manifest.source_video?await this.input(path.resolve(path.dirname(file),this.manifest.source_video),['.mp4','.webm','.mov'],250*1024*1024):null;
          this.manifest.source_video=this.videoPath?path.relative(this.root,this.videoPath):null;
        }result=await this.core('status');
      } else if(action==='video/import'){
        this.videoPath=await this.input(args.path,['.mp4','.webm','.mov'],250*1024*1024);this.manifest.source_video=path.relative(this.root,this.videoPath);result={source_video:this.manifest.source_video};
      } else if(action==='video/extract'){
        if(!this.videoPath)throw new Error('Import a video first');
        this.videoPath=await this.input(this.videoPath,['.mp4','.webm','.mov'],250*1024*1024);
        if(before.frames.length+args.frames>120)throw new Error('Maximum 120 frames per automation project');
        result=await this.core('extract',{url:'http://sprited.local/source-video?'+randomUUID(),name:path.basename(this.videoPath),start:args.start,end:args.end,count:args.frames,maxSize:args.max_size||512});this.manifest.target_frames=args.frames;
      } else if(action==='frames/align'||action==='frames/normalize'){
        result=await this.core(action.split('/')[1],{mode});this.manifest.alignment=mode;
      } else if(action==='frames/remove-background'){
        const settings={color:args.color||this.manifest.background,tolerance:args.tolerance??52,softness:args.softness??12};result=await this.core('remove-background',settings);this.manifest.background=settings.color;
      } else if(action==='animation/validate')result=await this.core('validate');
      else if(action==='frames/get')result=await this.core('frames');
      else if(action==='status')result={...await this.core('status'),manifest:this.manifest};
      else if(action==='animation/preview'){
        const preview=await this.core('preview');if(!preview.frames.length)throw new Error('No frames to preview');
        const dir=await this.directory(`exports/${randomUUID()}`),file=path.join(dir,'preview.html');
        const json=JSON.stringify(preview).replace(/</g,'\\u003c');
        await writeFile(file,`<!doctype html><meta charset="utf-8"><title>SPRITED animation preview</title><style>body{background:#28221e;color:white;font:16px system-ui;text-align:center}img{max-width:90vw;background:repeating-conic-gradient(#444 0 25%,#666 0 50%) 0/20px 20px}</style><h1>Animation preview</h1><img id="frame"><p id="count"></p><button id="toggle">Pause</button><script>const data=${json};let i=0,playing=true;const image=document.getElementById('frame'),label=document.getElementById('count');function tick(){image.src=data.frames[i].src;label.textContent=(i+1)+' / '+data.frames.length;setTimeout(()=>{if(playing){if(i<data.frames.length-1)i++;else if(data.loop)i=0;else playing=false;}tick()},data.frames[i].duration)}document.getElementById('toggle').onclick=e=>{playing=!playing;e.target.textContent=playing?'Pause':'Play'};tick();</script>`,{flag:'wx'});outputs=[file];result={frame_count:preview.frames.length};
      } else {
        const built=await this.core('build',{cols:args.cols||5});
        const dir=await this.directory(path.join(args.folder||'exports',`sprited-${randomUUID()}`));
        const png=path.join(dir,'spritesheet.png'),json=path.join(dir,'spritesheet.json');
        await writeFile(png,Buffer.from(built.png.split(',')[1],'base64'),{flag:'wx'});await writeFile(json,JSON.stringify(built.metadata,null,2),{flag:'wx'});outputs=[png,json];
        const projectFile=path.join(dir,'project.spriteproject'),manifestFile=path.join(dir,'manifest.json');
        await writeFile(projectFile,JSON.stringify(await this.core('snapshot')),{flag:'wx'});
        await writeFile(manifestFile,JSON.stringify({...this.manifest,project_file:'project.spriteproject',source_video:this.videoPath?path.relative(dir,this.videoPath):null},null,2),{flag:'wx'});
        outputs.push(projectFile,manifestFile);
        if(action==='export/godot'){
          const m=built.metadata,sections=[];for(let i=0;i<m.frames;i++)sections.push(`[sub_resource type="AtlasTexture" id="Atlas_${i}"]\natlas = ExtResource("1")\nregion = Rect2(${i%m.horizontal_frames*m.frame_width}, ${Math.floor(i/m.horizontal_frames)*m.frame_height}, ${m.frame_width}, ${m.frame_height})`);
          const resource=`[gd_resource type="SpriteFrames" load_steps=${m.frames+2} format=3]\n\n[ext_resource type="Texture2D" path="spritesheet.png" id="1"]\n\n${sections.join('\n\n')}\n\n[resource]\nanimations = [{\n"frames": [${m.durations_ms.map((d,i)=>`{"duration": ${d/1000}, "texture": SubResource("Atlas_${i}")}`).join(',')}],\n"loop": ${m.loop},\n"name": ${JSON.stringify(this.manifest.animation)},\n"speed": 1.0\n}]\n`;
          const file=path.join(dir,'animation.tres');await writeFile(file,resource,{flag:'wx'});outputs.push(file);
        }result=built.metadata;
      }
      if(!['status','frames/get','animation/validate','animation/preview','spritesheet/build','export/godot'].includes(action))await this.persist();
      return envelope(result,result?.warnings||[],outputs);
    }catch(error){if(before){await this.core('open',{project:before}).catch(()=>{});this.manifest=oldManifest;this.videoPath=oldVideo;}return failure(error);}
  }
  async close(){await this.tail;await this.browser?.close();if(this.ownsLock){await releaseLock(this.lockPath,this.lockContents);this.ownsLock=false;}}
}
