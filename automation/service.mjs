import {readFile,writeFile,rename,mkdir,realpath,stat,unlink,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {validate} from './contracts.mjs';
import {diagnostics} from './diagnostics.mjs';
import {Connections} from './connections.mjs';
import {acquireLock,releaseLock} from './lock.mjs';
import {ExternalManualProvider,LocalProcessProvider} from './image-provider.mjs';
import {validateAnimation,detectBadFrames} from './animation-validator.mjs';
import {encodeGif} from './gif-encoder.mjs';
import {ExternalManualVisionProvider,combineValidation} from './semantic-validator.mjs';
import {createRepairPlan,getAnimationStatus,DEFAULT_MAX_REPAIR_ATTEMPTS} from './repair-orchestrator.mjs';
const appRoot=fileURLToPath(new URL('../',import.meta.url));
export const envelope=(result={},warnings=[],output_paths=[])=>({success:true,status:'ok',result,warnings,errors:[],output_paths,next_suggested_action:null});
export const failure=error=>({success:false,status:'failed',result:null,warnings:[],errors:[error.message||String(error)],output_paths:[],next_suggested_action:null});
const compactAgentResult=value=>{
  if(Array.isArray(value))return value.map(compactAgentResult);
  if(!value||typeof value!=='object')return value;
  const result={};for(const [key,item] of Object.entries(value)){if(['reference_image','reference_image_path','storage_path','output_directory','source_video_path','source_frame_paths','output_frames_paths','extracted_frames_paths'].includes(key))continue;result[key]=compactAgentResult(item);}
  return result;
};
export class Service {
  constructor(root){this.root=path.resolve(root);this.tail=Promise.resolve();this.defaultImageProvider='external_manual';this.imageProviders={external_manual:new ExternalManualProvider()};this.visionProviders={external_manual:new ExternalManualVisionProvider()};this.manifest={version:1,character:'Character',animation:'animation',source_video:null,target_frames:24,background:'#00ff00',alignment:'body',frame_size:[512,512]};}
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
    await this.configureImageProviders();
    try {
      const session=JSON.parse(await readFile(await this.input('.sprited/session.json',['.json'],110*1024*1024),'utf8'));
      await this.openProject(session.project);this.manifest={...this.manifest,...this.safeManifest(session.manifest)};
      if(this.manifest.source_video)this.videoPath=await this.input(this.manifest.source_video,['.mp4','.webm','.mov'],250*1024*1024);
    }catch(error){if(error.code!=='ENOENT')throw error;}
    return this;
  }
  async configureImageProviders(){
    let config={default_provider:'external_manual',providers:{local_process:{enabled:false}}};try{const file=await this.input('.sprited/image-providers.json',['.json'],64*1024);config=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw Error('Invalid image provider configuration');}
    if(!['external_manual','local_process'].includes(config.default_provider)||!config.providers||typeof config.providers!=='object')throw Error('Invalid image provider configuration');this.defaultImageProvider=config.default_provider;
    this.imageProviders.local_process=new LocalProcessProvider(config.providers.local_process||{enabled:false},{tempRoot:await this.directory('.sprited/provider-tmp'),assetResolver:reference=>this.readContentReference(reference)});
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
  async storeProviderFrame(args,replace=false){
    const run=await this.core('workflow/animation/status',{id:args.animation_id}),records=run.frame_records||[],previous=replace?records.find(frame=>frame.frame_id===args.frame_id):null;
    if(replace&&!previous)throw Error('Frame not found');
    const providerId=args.provider||run.image_provider_id||this.defaultImageProvider,provider=this.imageProviders[providerId];if(!provider)throw Error('Unknown image provider');
    const frameIndex=previous?.frame_index??args.frame_index,prior=records.find(frame=>frame.frame_index===frameIndex-1),next=records.find(frame=>frame.frame_index===frameIndex+1),reference=`character:${run.character_profile_id}`,current=previous?`frame:${previous.frame_id}`:null,priorRef=prior?`frame:${prior.frame_id}`:null,nextRef=next?`frame:${next.frame_id}`:null;
    const request=providerId==='external_manual'?args:{animation_id:run.id,frame_index:frameIndex,animation_type:run.animation_type,reference_asset:reference,previous_frame:priorRef,next_frame:nextRef,current_frame:current,repair_reasons:args.repair_reasons||[],instruction:args.instruction,assets:{reference,current,previous:priorRef,next:nextRef}};
    const normalized=await provider[replace?'edit_frame':'generate_frame'](request),src=`data:${normalized.mime_type};base64,${normalized.bytes.toString('base64')}`;
    const dimensions=await this.page.evaluate(source=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve({width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>reject(Error('Image could not be decoded'));image.src=source;}),src);
    if(dimensions.width*dimensions.height>4*1024*1024)throw Error('Frame exceeds 4 megapixels');
    const frameId=previous?.frame_id||randomUUID(),createdAt=previous?.created_at||new Date().toISOString(),dir=await this.directory(`SPRITED_DATA/characters/${run.character_profile_id}/animations/${run.animation_type.toLowerCase()}/${run.id}/frames`),target=path.join(dir,`${frameId}-${randomUUID()}.${normalized.format}`);
    await writeFile(target,normalized.bytes,{flag:'wx'});
    const record={frame_id:frameId,character_id:run.character_profile_id,animation_id:run.id,frame_index:frameIndex,format:normalized.format,width:dimensions.width,height:dimensions.height,created_at:createdAt,provider:providerId,storage_path:path.relative(this.root,target)};
    let result;try{result=await this.core('workflow/animation/store-frame',{id:run.id,record,replace});await this.persist();}catch(error){await unlink(target).catch(()=>{});throw error;}
    if(previous?.storage_path&&previous.storage_path!==record.storage_path){const old=await this.input(previous.storage_path,['.png','.webp'],9*1024*1024).catch(()=>null);if(old)await unlink(old).catch(()=>{});}
    return result;
  }
  async materializeStoredFrames(id){
    const run=await this.core('workflow/animation/status',{id}),records=(run.frame_records||[]).toSorted((a,b)=>a.frame_index-b.frame_index);
    if(records.length<2)throw Error('Submit at least two frames before building a sprite sheet');
    if(records.some((frame,index)=>frame.frame_index!==index))throw Error('Frame indexes must be contiguous and start at 0');
    const frames=[];for(const record of records){const file=await this.input(record.storage_path,['.png','.webp'],9*1024*1024),bytes=await readFile(file);frames.push({path:record.storage_path,name:`Frame ${String(record.frame_index+1).padStart(2,'0')}`,src:`data:image/${record.format};base64,${bytes.toString('base64')}`});}
    return this.core('workflow/animation/attach-frames',{id,frames,provider:run.image_provider_id||'external_manual'});
  }
  async decodeStoredFrames(id,full=false){
    const run=await this.core('workflow/animation/status',{id}),records=run.frame_records||[],inputs=[];
    for(const record of records){try{const file=await this.input(record.storage_path,['.png','.webp'],9*1024*1024),bytes=await readFile(file);inputs.push({record,src:`data:image/${record.format};base64,${bytes.toString('base64')}`});}catch{inputs.push({record,src:null});}}
    const decoded=await this.page.evaluate(async({inputs,full})=>Promise.all(inputs.map(async input=>{if(!input.src)return null;try{const image=await new Promise((resolve,reject)=>{const value=new Image();value.onload=()=>resolve(value);value.onerror=()=>reject(Error());value.src=input.src;});const scale=full?1:Math.min(1,128/image.naturalWidth,128/image.naturalHeight),width=Math.max(1,Math.round(image.naturalWidth*scale)),height=Math.max(1,Math.round(image.naturalHeight*scale)),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,width,height);return {width:image.naturalWidth,height:image.naturalHeight,pixel_width:width,pixel_height:height,rgba:Array.from(context.getImageData(0,0,width,height).data)};}catch{return null;}})),{inputs,full});
    return {run,frames:inputs.map((input,index)=>({frame_id:input.record.frame_id,animation_id:id,frame_index:input.record.frame_index,format:input.record.format,width:decoded[index]?.width||input.record.width,height:decoded[index]?.height||input.record.height,pixel_width:decoded[index]?.pixel_width,pixel_height:decoded[index]?.pixel_height,rgba:decoded[index]?.rgba||null}))};
  }
  async runTechnicalValidation(id){const {run,frames}=await this.decodeStoredFrames(id);const validation=validateAnimation(frames,{background:run.options.background,loop:run.options.loop??run.recipe_snapshot.loop}),combined=run.semantic_validation?combineValidation(validation,run.semantic_validation):null;await this.core('workflow/animation/record-validation',{id,validation,combined});await this.persist();return validation;}
  async readContentReference(reference){
    let record,extensions;if(reference.startsWith('frame:')){record=await this.core('workflow/frame/find',{id:reference.slice(6)});extensions=['.png','.webp'];}
    else if(reference.startsWith('contact-sheet:')){record=await this.core('workflow/asset/find',{id:reference.slice(14)});extensions=['.png'];}
    else if(reference.startsWith('character:')){record=await this.core('workflow/character/find',{id:reference.slice(10)});const match=/^data:image\/(png|webp);base64,(.+)$/.exec(record.reference_image||'');if(!match)throw Error('Character reference is unavailable');return {bytes:Buffer.from(match[2],'base64'),mime_type:`image/${match[1]}`};}
    else throw Error('Unsupported asset reference');
    const file=await this.input(record.storage_path,extensions,12*1024*1024),bytes=await readFile(file),ext=path.extname(file).slice(1).toLowerCase();return {bytes,mime_type:`image/${ext}`};
  }
  async buildContactSheet(args){
    const run=await this.core('workflow/animation/status',{id:args.animation_id}),records=(run.frame_records||[]).toSorted((a,b)=>a.frame_index-b.frame_index);if(!records.length)throw Error('Animation has no frames');
    if(records.some((frame,index)=>frame.frame_index!==index))throw Error('Frame indexes must be contiguous and start at 0');
    const inputs=[];for(const record of records){const file=await this.input(record.storage_path,['.png','.webp'],9*1024*1024),bytes=await readFile(file);inputs.push({src:`data:image/${record.format};base64,${bytes.toString('base64')}`,frame_index:record.frame_index});}
    const columns=args.columns||Math.min(6,Math.max(1,Math.ceil(Math.sqrt(records.length)))),includeNumbers=args.include_frame_numbers!==false;
    const rendered=await this.page.evaluate(async({inputs,columns,includeNumbers})=>{const images=await Promise.all(inputs.map(input=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve({image,input});image.onerror=()=>reject(Error('Frame could not be decoded'));image.src=input.src;})));const maxWidth=Math.min(256,Math.max(...images.map(v=>v.image.naturalWidth))),maxHeight=Math.min(256,Math.max(...images.map(v=>v.image.naturalHeight))),labelHeight=includeNumbers?24:0,padding=8,cellWidth=maxWidth+padding*2,cellHeight=maxHeight+labelHeight+padding*2,rows=Math.ceil(images.length/columns),canvas=document.createElement('canvas');canvas.width=cellWidth*columns;canvas.height=cellHeight*rows;const context=canvas.getContext('2d');context.fillStyle='#151b2b';context.fillRect(0,0,canvas.width,canvas.height);images.forEach(({image,input},index)=>{const col=index%columns,row=Math.floor(index/columns),scale=Math.min(1,maxWidth/image.naturalWidth,maxHeight/image.naturalHeight),width=Math.round(image.naturalWidth*scale),height=Math.round(image.naturalHeight*scale),x=col*cellWidth+padding+(maxWidth-width)/2,y=row*cellHeight+padding+(maxHeight-height)/2;context.drawImage(image,x,y,width,height);if(includeNumbers){context.fillStyle='#e7efff';context.font='14px sans-serif';context.textAlign='center';context.fillText(String(input.frame_index),col*cellWidth+cellWidth/2,row*cellHeight+padding+maxHeight+17);}});return {data_url:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height,rows};},{inputs,columns,includeNumbers});
    const contactSheetId=randomUUID(),dir=await this.directory(`SPRITED_DATA/characters/${run.character_profile_id}/animations/${run.animation_type.toLowerCase()}/${run.id}/contact-sheets`),file=path.join(dir,contactSheetId+'.png');await writeFile(file,Buffer.from(rendered.data_url.split(',')[1],'base64'),{flag:'wx'});
    const contactSheet={contact_sheet_id:contactSheetId,animation_id:run.id,frame_count:records.length,columns,rows:rendered.rows,width:rendered.width,height:rendered.height,format:'png',include_frame_numbers:includeNumbers,ordered_frame_ids:records.map(frame=>frame.frame_id),content_reference:`contact-sheet:${contactSheetId}`,storage_path:path.relative(this.root,file),created_at:new Date().toISOString()};await this.core('workflow/animation/record-contact-sheet',{id:run.id,contact_sheet:contactSheet});await this.persist();const {storage_path,...publicResult}=contactSheet;return publicResult;
  }
  async semanticValidateFrame(args){
    const frame=await this.core('workflow/frame/find',{id:args.frame_id});
    const allowedIndexes=new Set([frame.frame_index]);for(const id of args.neighboring_frame_ids||[]){const neighbor=await this.core('workflow/frame/find',{id});if(neighbor.animation_id!==frame.animation_id)throw Error('Neighboring frames must belong to the same animation');allowedIndexes.add(neighbor.frame_index);}
    const validation=await this.visionProviders.external_manual.validate_frame({animation_id:frame.animation_id,frame_id:frame.frame_id,supervisor_result:args.supervisor_result});if(validation.bad_frames.some(index=>!allowedIndexes.has(index)))throw Error('Semantic issue references a frame outside the submitted inspection set');const run=await this.core('workflow/animation/status',{id:frame.animation_id}),combined=combineValidation(run.technical_validation,validation);await this.core('workflow/animation/record-semantic',{id:frame.animation_id,validation,combined});await this.persist();return {validation,combined_validation:combined};
  }
  async semanticValidateAnimation(args){
    const run=await this.core('workflow/animation/status',{id:args.animation_id}),records=run.frame_records||[];if(!records.length)throw Error('Animation has no frames');const maxIndex=Math.max(...records.map(frame=>frame.frame_index));
    const validation=await this.visionProviders.external_manual.validate_animation({animation_id:run.id,max_frame_index:maxIndex,supervisor_result:args.supervisor_result}),validIndexes=new Set(records.map(frame=>frame.frame_index));if(validation.bad_frames.some(index=>!validIndexes.has(index)))throw Error('Semantic issue references a missing frame');const combined=combineValidation(run.technical_validation,validation);await this.core('workflow/animation/record-semantic',{id:run.id,validation,combined});await this.persist();return {validation,combined_validation:combined,animation_status:getAnimationStatus(await this.core('workflow/animation/status',{id:run.id}),{maxAttempts:DEFAULT_MAX_REPAIR_ATTEMPTS})};
  }
  async getRepairPlan(animationId){const run=await this.core('workflow/animation/status',{id:animationId}),status=getAnimationStatus(run,{maxAttempts:DEFAULT_MAX_REPAIR_ATTEMPTS});if(status.overall_status==='needs_validation')throw Error('Run technical validation before creating a repair plan');if(status.overall_status==='needs_semantic_validation'||status.overall_status==='needs_semantic_reinspection')throw Error('Semantic inspection is required before creating another repair plan');if(status.overall_status==='passed')throw Error('Animation already passes; no repair plan is needed');const plan=createRepairPlan(run,{maxAttempts:DEFAULT_MAX_REPAIR_ATTEMPTS});if(!(run.repair_plans||[]).some(item=>item.repair_plan_id===plan.repair_plan_id)){await this.core('workflow/animation/record-repair-plan',{id:run.id,plan});await this.persist();}return plan;}
  async submitRepairFrame(args){const found=await this.core('workflow/repair/find',{id:args.repair_plan_id}),target=found.plan.frames_to_repair.find(frame=>frame.frame_index===args.frame_index);if(found.plan.status!=='active')throw Error('Repair plan is not active');if(!target)throw Error('Frame is not included in this repair plan');const frame=await this.storeProviderFrame({animation_id:found.animation_id,frame_id:target.frame_id,provider:args.provider,format:args.format,image_base64:args.image_base64,instruction:args.instruction,repair_reasons:target.reasons},true);await this.core('workflow/animation/record-repair-frame',{id:found.animation_id,repair_plan_id:args.repair_plan_id,frame_index:args.frame_index});await this.persist();return {repair_plan_id:args.repair_plan_id,frame,repaired_frame_indexes:[...new Set([...(found.plan.repaired_frame_indexes||[]),args.frame_index])].sort((a,b)=>a-b),animation_status:getAnimationStatus(await this.core('workflow/animation/status',{id:found.animation_id}),{maxAttempts:DEFAULT_MAX_REPAIR_ATTEMPTS})};}
  async evaluateRepair(repairPlanId){const found=await this.core('workflow/repair/find',{id:repairPlanId});if(found.plan.status!=='active')throw Error('Repair plan is not active');if(!found.plan.repaired_frame_indexes?.length)throw Error('Submit at least one repair frame before evaluation');const gif=await this.buildGifPreview({animation_id:found.animation_id}),technical=await this.runTechnicalValidation(found.animation_id),contactSheet=await this.buildContactSheet({animation_id:found.animation_id,include_frame_numbers:true});await this.core('workflow/animation/record-repair-evaluation',{id:found.animation_id,repair_plan_id:repairPlanId,technical_score:technical.score,gif_preview_id:gif.preview_id,contact_sheet_id:contactSheet.contact_sheet_id});await this.persist();return {repair_plan_id:repairPlanId,technical:{passed:technical.passed,score:technical.score},loop:{passed:technical.loop_validation.passed,score:technical.loop_validation.loop_score},semantic_status:'needs_reinspection',repaired_frames:found.plan.repaired_frame_indexes,gif_preview_id:gif.preview_id,contact_sheet_id:contactSheet.contact_sheet_id,contact_sheet_reference:contactSheet.content_reference,animation_status:getAnimationStatus(await this.core('workflow/animation/status',{id:found.animation_id}),{maxAttempts:DEFAULT_MAX_REPAIR_ATTEMPTS})};}
  async buildGifPreview(args){
    const {run,frames}=await this.decodeStoredFrames(args.animation_id,true);if(frames.some(frame=>!frame.rgba))throw Error('All frames must be valid PNG/WebP images');if(frames.reduce((sum,frame)=>sum+frame.width*frame.height,0)>32*1024*1024)throw Error('Animation exceeds GIF pixel budget');
    const ordered=[...frames].sort((a,b)=>a.frame_index-b.frame_index);if(ordered.some((frame,index)=>frame.frame_index!==index))throw Error('Frame indexes must be contiguous and start at 0');
    const duration=args.frame_duration_ms||Math.max(20,Math.round((run.options.end-run.options.start)*1000/ordered.length)||80),loop=args.loop??run.options.loop??run.recipe_snapshot.loop,bytes=encodeGif(ordered,{frame_duration_ms:duration,loop}),previewId=randomUUID(),dir=await this.directory(`SPRITED_DATA/characters/${run.character_profile_id}/animations/${run.animation_type.toLowerCase()}/${run.id}/previews`),file=path.join(dir,previewId+'.gif');await writeFile(file,bytes,{flag:'wx'});
    const preview={preview_id:previewId,animation_id:run.id,frame_count:ordered.length,width:ordered[0].width,height:ordered[0].height,frame_duration_ms:duration,loop,format:'gif',asset_reference:`preview:${previewId}`,storage_path:path.relative(this.root,file)};await this.core('workflow/animation/record-preview',{id:run.id,preview});await this.persist();const {storage_path,...result}=preview;return result;
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
      if(action==='agent/get-character'){const character=await this.core('workflow/character/select',{id:args.id});return envelope({...compactAgentResult(character),content_reference:`character:${character.id}`});}
      if(action==='agent/generate-animation'){
        const recipes=await this.core('workflow/recipes/list'),recipe=recipes.find(r=>r.animation_type===args.animation_type);if(!recipe)throw Error('Unknown animation type');
        const job=await this.core('workflow/jobs/create',{character_id:args.character_id,animation_type:args.animation_type,duration:recipe.target_duration,loop:recipe.loop,frames:recipe.default_output_frame_count,sampling:'uniform'}),provider=args.provider||this.defaultImageProvider;await this.core('workflow/animation/set-image-provider',{id:job.attempt_id,provider});await this.directory(job.output_directory);await writeFile(path.join(this.root,job.output_directory,'job.json'),JSON.stringify(job,null,2),{flag:'wx'});await this.persist();return {...envelope({...compactAgentResult(job),image_provider:provider}),status:'queued',next_suggested_action:provider==='local_process'?'Call submit_frame for each frame index; SPRITED will invoke the configured local process.':'Create ordered PNG/WebP images and call submit_frame for each frame.'};
      }
      if(action==='agent/redo-animation'){
        const job=await this.core('workflow/attempts/redo',{id:args.id});await this.directory(job.output_directory);await writeFile(path.join(this.root,job.output_directory,'job.json'),JSON.stringify(job,null,2),{flag:'wx'});
        await this.persist();return {...envelope(compactAgentResult(job)),status:'queued',next_suggested_action:'Call submit_frame for each replacement frame.'};
      }
      if(action==='agent/use-result'){result=await this.core('workflow/animation/approve',{id:args.id});await this.persist();return {...envelope(compactAgentResult(result),result.warnings||[]),status:'approved',next_suggested_action:'Call build_spritesheet.'};}
      if(action==='agent/submit-frame'){result=await this.storeProviderFrame(args,false);return {...envelope(result),status:'stored',next_suggested_action:'Submit the next frame or call list_frames.'};}
      if(action==='agent/replace-frame'){result=await this.storeProviderFrame(args,true);return {...envelope(result),status:'replaced',next_suggested_action:'Call list_frames to verify the sequence.'};}
      if(action==='agent/list-frames')return envelope(await this.core('workflow/animation/list-frames',{id:args.animation_id}));
      if(action==='agent/build-gif'){result=await this.buildGifPreview(args);return {...envelope(result),status:'ready'};}
      if(action==='agent/validate-animation'){result=await this.runTechnicalValidation(args.animation_id);return {...envelope(result),status:result.passed?'passed':'issues_found'};}
      if(action==='agent/detect-bad-frames'){const run=await this.core('workflow/animation/status',{id:args.animation_id}),validation=run.technical_validation||await this.runTechnicalValidation(args.animation_id);return envelope(detectBadFrames(validation));}
      if(action==='agent/validate-loop'){const run=await this.core('workflow/animation/status',{id:args.animation_id}),validation=run.technical_validation||await this.runTechnicalValidation(args.animation_id);return {...envelope({animation_id:args.animation_id,...validation.loop_validation}),status:validation.loop_validation.passed?'passed':'issues_found'};}
      if(action==='agent/get-frame-asset'){const frame=await this.core('workflow/frame/find',{id:args.frame_id}),{storage_path,...publicFrame}=frame;return envelope({...publicFrame,content_reference:`frame:${frame.frame_id}`});}
      if(action==='agent/build-contact-sheet'){result=await this.buildContactSheet(args);return {...envelope(result),status:'ready'};}
      if(action==='agent/semantic-validate-frame'){result=await this.semanticValidateFrame(args);return {...envelope(result),status:result.validation.passed?'passed':'issues_found'};}
      if(action==='agent/semantic-validate-animation'){result=await this.semanticValidateAnimation(args);return {...envelope(result),status:result.animation_status.overall_status,next_suggested_action:result.animation_status.recommended_next_action};}
      if(action==='agent/get-repair-plan'){result=await this.getRepairPlan(args.animation_id);return {...envelope(result),status:result.overall_passed?'passed':'needs_repair',next_suggested_action:result.recommended_next_action};}
      if(action==='agent/submit-repair-frame'){result=await this.submitRepairFrame(args);return {...envelope(result),status:'repair_submitted',next_suggested_action:result.animation_status.recommended_next_action};}
      if(action==='agent/evaluate-repair'){result=await this.evaluateRepair(args.repair_plan_id);return {...envelope(result),status:'needs_semantic_reinspection',next_suggested_action:'Inspect the new contact sheet and call semantic_validate_animation.'};}
      if(action==='agent/get-animation-status'){result=getAnimationStatus(await this.core('workflow/animation/status',{id:args.animation_id}),{maxAttempts:DEFAULT_MAX_REPAIR_ATTEMPTS});return {...envelope(result),status:result.overall_status};}
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
