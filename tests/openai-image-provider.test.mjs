import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {OpenAIImageProvider} from '../automation/openai-image-provider.mjs';
import {Service,failure} from '../automation/service.mjs';
import {tools} from '../automation/contracts.mjs';
await import('../public/character-workflow.js');

const tinyPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XyVZ5wAAAABJRU5ErkJggg==','base64');
const config={enabled:true,api_key_env:'SPRITED_TEST_OPENAI_KEY',model:'gpt-image-2.5-sunburst',default_size:'1024x1024',default_quality:'medium',timeout_ms:5000};
const okFetch=(bytes,calls=[])=>async(url,options)=>{calls.push({url,options});return {ok:true,headers:{get:name=>name==='x-request-id'?'req_mock_1':null},json:async()=>({data:[{b64_json:bytes.toString('base64')} ]})};};
const resolver=async reference=>({bytes:tinyPng,mime_type:reference.endsWith('webp')?'image/webp':'image/png'});

test('OpenAI provider validates safe configuration and reports a missing environment key',async()=>{
  assert.throws(()=>new OpenAIImageProvider({...config,api_key:'secret'}),/environment variable/);
  assert.throws(()=>new OpenAIImageProvider({...config,default_size:'512x512'}),/supported range/);
  const provider=new OpenAIImageProvider(config,{environment:{},assetResolver:resolver,fetchImpl:okFetch(tinyPng)});
  await assert.rejects(()=>provider.generate_frame({frame_index:0,assets:{reference:'character:c'}}),/not configured in SPRITED_TEST_OPENAI_KEY/);
});

test('OpenAI generate_frame maps reference and neighbors to one image-edit request',async()=>{
  const calls=[],provider=new OpenAIImageProvider(config,{environment:{SPRITED_TEST_OPENAI_KEY:'sk-test-generate'},assetResolver:resolver,fetchImpl:okFetch(tinyPng,calls)});
  const result=await provider.generate_frame({animation_type:'WALKING',frame_index:3,total_frame_count:8,direction:'right',required_output_size:[256,256],background_requirement:'transparent',instruction:'Advance the right leg.',assets:{reference:'character:c',previous:'frame:p',next:'frame:n'}});
  assert.equal(result.provider,'openai_api');assert.equal(result.format,'png');assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.openai.com/v1/images/edits');
  const form=calls[0].options.body;assert.equal(form.get('model'),'gpt-image-2.5-sunburst');assert.equal(form.get('n'),'1');assert.equal(form.get('output_format'),'png');assert.equal(form.getAll('image[]').length,3);assert.deepEqual(form.getAll('image[]').map(file=>file.name),['reference.png','previous.png','next.png']);assert.match(form.get('prompt'),/frame 4 of 8/i);assert.match(form.get('prompt'),/Direction: right/);assert.match(form.get('prompt'),/256x256/);assert.match(form.get('prompt'),/Input image order: reference, previous, next/);
});

test('OpenAI edit_frame maps current/reference/neighbors and sanitizes provider errors',async()=>{
  const calls=[],secret='unusual-secret-value',provider=new OpenAIImageProvider(config,{environment:{SPRITED_TEST_OPENAI_KEY:secret},assetResolver:resolver,fetchImpl:okFetch(tinyPng,calls)});
  await provider.edit_frame({animation_type:'ATTACK',frame_index:2,total_frame_count:8,required_output_size:[256,256],repair_reasons:['direction_flip'],repair_issue_descriptions:['Weapon points backward.'],assets:{current:'frame:c',reference:'character:r',previous:'frame:p',next:'frame:n'}});
  const form=calls[0].options.body;assert.deepEqual(form.getAll('image[]').map(file=>file.name),['current.png','reference.png','previous.png','next.png']);assert.match(form.get('prompt'),/Repair issues: direction_flip; Weapon points backward/);assert.match(form.get('prompt'),/Input image order: current, reference, previous, next/);
  const failed=new OpenAIImageProvider(config,{environment:{SPRITED_TEST_OPENAI_KEY:secret},assetResolver:resolver,fetchImpl:async()=>({ok:false,status:401,statusText:'Unauthorized',json:async()=>({error:{message:`Rejected ${secret} and sk-visible-test`}})})});
  let caught;try{await failed.generate_frame({frame_index:0,assets:{reference:'character:r'}});}catch(error){caught=error;}const publicError=failure(caught);assert.equal(publicError.success,false);assert.equal(JSON.stringify(publicError).includes(secret),false);assert.equal(JSON.stringify(publicError).includes('sk-visible-test'),false);assert.equal('stack' in publicError,false);assert.match(publicError.errors[0],/\[redacted\]/);
});

test('OpenAI mocked result imports one frame and repairs it through the existing pipeline',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'sprited-openai-')),secret='service-secret-value',calls=[],run={id:'animation-1',character_profile_id:'character-1',animation_type:'WALKING',image_provider_id:'openai_api',provider_usage:{paid_generations:0,paid_repairs:0},options:{output_frames:8,canvas_width:256,canvas_height:256,background_mode:'key',background:'#00ff00'},recipe_snapshot:{default_output_frame_count:8},frame_records:[]},plan={repair_plan_id:'repair-1',status:'active',repaired_frame_indexes:[],frames_to_repair:[{frame_index:3,frame_id:null,reasons:['direction_flip'],issue_descriptions:['Weapon points backward.']}]};
  try{
    const provider=new OpenAIImageProvider(config,{environment:{SPRITED_TEST_OPENAI_KEY:secret},assetResolver:async()=>({bytes:tinyPng,mime_type:'image/png'}),fetchImpl:okFetch(tinyPng,calls)}),service={root,imageProviders:{openai_api:provider},defaultImageProvider:'external_manual',providerPolicy:{default_provider:'openai_api',allow_paid_providers:true,require_confirmation_for_paid_request:true,max_paid_image_generations_per_animation:20,max_paid_repair_generations_per_animation:3},page:{evaluate:async()=>({width:1,height:1})},persist:async()=>{},directory:async relative=>{const dir=path.join(root,relative);await import('node:fs/promises').then(fs=>fs.mkdir(dir,{recursive:true}));return dir;},input:async relative=>path.join(root,relative)};
    service.core=async(operation,args)=>{if(operation==='workflow/animation/status')return structuredClone(run);if(operation==='workflow/animation/store-frame'){if(args.replace){const current=run.frame_records.find(frame=>frame.frame_id===args.record.frame_id);Object.assign(current,args.record,{frame_index:current.frame_index,created_at:current.created_at});return Object.fromEntries(Object.entries(current).filter(([key])=>key!=='storage_path'));}run.frame_records.push(args.record);return Object.fromEntries(Object.entries(args.record).filter(([key])=>key!=='storage_path'));}if(operation==='workflow/animation/record-provider-usage'){run.provider_usage[args.counter]++;return run.provider_usage;}if(operation==='workflow/repair/find')return {animation_id:run.id,plan};if(operation==='workflow/animation/record-repair-frame'){if(!plan.repaired_frame_indexes.includes(args.frame_index))plan.repaired_frame_indexes.push(args.frame_index);return plan;}throw Error(`Unexpected core operation: ${operation}`);};service.storeProviderFrame=(args,replace)=>Service.prototype.storeProviderFrame.call(service,args,replace);
    const first=await Service.prototype.storeProviderFrame.call(service,{animation_id:run.id,frame_index:0,provider:'openai_api',confirm_paid_request:true,instruction:'Canonical walk contact.'});assert.equal(first.provider,'openai_api');assert.equal(first.provider_metadata.model,'gpt-image-2.5-sunburst');assert.equal(run.frame_records.length,1);
    for(let index=1;index<8;index++)await Service.prototype.storeProviderFrame.call(service,{animation_id:run.id,frame_index:index,provider:'openai_api',confirm_paid_request:true});plan.frames_to_repair[0].frame_id=run.frame_records[3].frame_id;const before=structuredClone(run.frame_records[3]),repaired=await Service.prototype.submitRepairFrame.call(service,{repair_plan_id:plan.repair_plan_id,frame_index:3,provider:'openai_api',confirm_paid_request:true});assert.equal(repaired.frame.frame_id,before.frame_id);assert.equal(repaired.frame.provider,'openai_api');assert.deepEqual(repaired.repaired_frame_indexes,[3]);
    const repairForm=calls.at(-1).options.body;assert.deepEqual(repairForm.getAll('image[]').map(file=>file.name),['current.png','reference.png','previous.png','next.png']);assert.match(repairForm.get('prompt'),/direction_flip/);assert.match(repairForm.get('prompt'),/Weapon points backward/);assert.equal(calls.length,9);assert.equal(JSON.stringify(repaired).includes(secret),false);
    assert.equal(tools.length,22);assert.ok(tools.find(tool=>tool.name==='submit_repair_frame').inputSchema.properties.provider.enum.includes('openai_api'));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('redo persistence regression remains fixed with provider frame metadata',()=>{
  const workflow=globalThis.SpritedWorkflow,state=workflow.empty(),src=`data:image/png;base64,${tinyPng.toString('base64')}`,character=workflow.setReference(state,{src,name:'Redo Check'}),job=workflow.library(state,'jobs/create',{character_id:character.id,animation_type:'WALKING',duration:1.6,loop:true,frames:8,sampling:'uniform'}),original=workflow.get(state,job.attempt_id);
  original.frame_records=[{frame_id:'stable-frame',character_id:character.id,animation_id:original.id,frame_index:0,format:'png',width:1,height:1,created_at:new Date().toISOString(),provider:'openai_api',provider_metadata:{model:'gpt-image-2.5-sunburst'},storage_path:'SPRITED_DATA/frame.png'}];original.source_frame_paths=['SPRITED_DATA/frame.png'];original.repair_history=[{repair_plan_id:'repair-old'}];
  const redoJob=workflow.library(state,'attempts/redo',{id:original.id}),reloaded=workflow.hydrate(JSON.parse(JSON.stringify(state))),oldRun=workflow.get(reloaded,original.id),redo=workflow.get(reloaded,redoJob.attempt_id);
  assert.equal(oldRun.frame_records[0].frame_id,'stable-frame');assert.equal(oldRun.frame_records[0].provider,'openai_api');assert.deepEqual(redo.frame_records,[]);assert.deepEqual(redo.source_frame_paths,[]);assert.deepEqual(redo.repair_history,[]);assert.equal(redo.parent_run_id,oldRun.id);
});
