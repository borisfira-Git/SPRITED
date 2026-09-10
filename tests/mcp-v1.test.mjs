import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {Service} from '../automation/service.mjs';

const root=path.resolve(process.env.SPRITED_TEST_WORKSPACE);
await mkdir(root,{recursive:true});
const service=new Service(root);
let character,images,animationId;
try{
  await service.init();
  images=await service.page.evaluate(()=>[40,70,100,130,160,130,100,70,129].map(value=>{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');x.clearRect(0,0,64,64);x.fillStyle=`rgb(${value} ${value} ${value})`;x.fillRect(18,8,28,48);return c.toDataURL('image/png');}));
  for(let i=0;i<images.length;i++)await writeFile(path.join(root,`frame-${i}.png`),Buffer.from(images[i].split(',')[1],'base64'));
  const created=await service.call('character/create',{path:'frame-0.png',name:'MCP Frame Test'});assert.equal(created.success,true,JSON.stringify(created));character=created.result;
}finally{await service.close();}

const child=spawn(process.execPath,[path.resolve('automation/cli.mjs'),'mcp','--workspace',root],{stdio:['pipe','pipe','pipe']});
const pending=new Map();let sequence=0,stderr='';child.stderr.on('data',d=>stderr+=d);createInterface({input:child.stdout}).on('line',line=>{const message=JSON.parse(line);pending.get(message.id)?.(message);pending.delete(message.id);});
const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error(`MCP timeout: ${stderr}`)),30000);pending.set(id,message=>{clearTimeout(timer);resolve(message);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
const toolResponse=(name,args={})=>rpc('tools/call',{name,arguments:args});
const tool=async(name,args={})=>{const response=await toolResponse(name,args);assert.equal(response.result.isError,false,JSON.stringify(response));return response.result.structuredContent;};
try{
  await rpc('initialize',{clientInfo:{name:'focused-mcp-v1-test'}});
  const listed=await rpc('tools/list');assert.deepEqual(listed.result.tools.map(t=>t.name),['list_characters','get_character','generate_animation','redo_animation','use_result','build_spritesheet','submit_frame','replace_frame','list_frames','build_gif','validate_animation','detect_bad_frames','validate_loop','get_frame_asset','build_contact_sheet','semantic_validate_frame','semantic_validate_animation','get_repair_plan','submit_repair_frame','evaluate_repair','get_animation_status']);
  assert.equal((await tool('list_characters')).result.length,1);
  assert.equal((await tool('get_character',{id:character.id})).result.name,'MCP Frame Test');
  const request=await tool('generate_animation',{character_id:character.id,animation_type:'WALKING'});assert.equal(request.status,'queued');animationId=request.result.attempt_id;
  for(let i=0;i<8;i++)await tool('submit_frame',{animation_id:animationId,frame_index:i,format:'png',image_base64:images[i].split(',')[1]});
  let frames=(await tool('list_frames',{animation_id:request.result.attempt_id})).result;assert.equal(frames.length,8);assert.deepEqual(frames.map(f=>f.frame_index),[0,1,2,3,4,5,6,7]);assert.ok(frames.every(f=>f.character_id===character.id&&f.animation_id===request.result.attempt_id&&f.format==='png'&&f.width===64&&f.height===64&&f.created_at&&!('storage_path'in f)));
  const stableId=frames[3].frame_id,createdAt=frames[3].created_at;const replaced=await tool('replace_frame',{animation_id:request.result.attempt_id,frame_id:stableId,format:'png',image_base64:images[3].split(',')[1]});assert.equal(replaced.result.frame_id,stableId);assert.equal(replaced.result.created_at,createdAt);frames=(await tool('list_frames',{animation_id:request.result.attempt_id})).result;assert.equal(frames[3].frame_id,stableId);
  const assetResponse=await toolResponse('get_frame_asset',{frame_id:stableId});assert.equal(assetResponse.result.isError,false);assert.equal(assetResponse.result.content[1].type,'image');assert.equal(assetResponse.result.content[1].mimeType,'image/png');assert.match(assetResponse.result.structuredContent.result.content_reference,/^frame:/);assert.ok(!('storage_path'in assetResponse.result.structuredContent.result));
  const missingAsset=await toolResponse('get_frame_asset',{frame_id:'missing-frame'});assert.equal(missingAsset.result.isError,true);assert.match(missingAsset.result.structuredContent.errors[0],/Frame not found/);
  const contactResponse=await toolResponse('build_contact_sheet',{animation_id:request.result.attempt_id,columns:4,include_frame_numbers:true});assert.equal(contactResponse.result.isError,false);assert.equal(contactResponse.result.content[1].type,'image');assert.equal(contactResponse.result.structuredContent.result.frame_count,8);assert.deepEqual(contactResponse.result.structuredContent.result.ordered_frame_ids,frames.map(frame=>frame.frame_id));assert.ok(!('storage_path'in contactResponse.result.structuredContent.result));
  const gif=await tool('build_gif',{animation_id:request.result.attempt_id,frame_duration_ms:80,loop:true});assert.equal(gif.result.format,'gif');assert.equal(gif.result.frame_count,8);assert.match(gif.result.asset_reference,/^preview:/);assert.ok(!('storage_path'in gif.result));
  const validation=await tool('validate_animation',{animation_id:request.result.attempt_id});assert.equal(validation.result.frame_count,8);assert.ok(Array.isArray(validation.result.issues));const bad=await tool('detect_bad_frames',{animation_id:request.result.attempt_id});assert.equal(bad.result.animation_id,request.result.attempt_id);assert.ok(Array.isArray(bad.result.bad_frames));const loop=await tool('validate_loop',{animation_id:request.result.attempt_id});assert.equal(loop.result.first_frame_index,0);assert.equal(loop.result.last_frame_index,7);
  const semanticFrame=await tool('semantic_validate_frame',{frame_id:stableId,neighboring_frame_ids:[frames[2].frame_id,frames[4].frame_id],supervisor_result:{passed:true,score:93,issues:[]}});assert.equal(semanticFrame.result.validation.frame_id,stableId);assert.equal(semanticFrame.result.validation.passed,true);
  const invalidSemantic=await toolResponse('semantic_validate_frame',{frame_id:stableId,supervisor_result:{passed:true,score:101,issues:[]}});assert.equal(invalidSemantic.result.isError,true);
  const semanticAnimation=await tool('semantic_validate_animation',{animation_id:request.result.attempt_id,supervisor_result:{passed:false,score:44,issues:[{type:'leg_progression',frame_index:5,severity:'high',description:'The same leg remains forward instead of alternating.'}]}});assert.deepEqual(semanticAnimation.result.validation.bad_frames,[5]);assert.equal(semanticAnimation.result.combined_validation.overall_passed,false);
  const beforeRepairFrames=(await tool('list_frames',{animation_id:animationId})).result,badBefore=(await toolResponse('get_frame_asset',{frame_id:beforeRepairFrames[5].frame_id})).result.content[1].data,neighborBefore=(await toolResponse('get_frame_asset',{frame_id:beforeRepairFrames[4].frame_id})).result.content[1].data;
  const statusBefore=await tool('get_animation_status',{animation_id:animationId});assert.equal(statusBefore.result.overall_status,'needs_repair');assert.equal(statusBefore.result.export_ready,false);
  const plan=await tool('get_repair_plan',{animation_id:animationId});assert.equal(plan.result.attempt,1);assert.equal(plan.result.frames_to_repair[0].frame_index,5);assert.match(plan.result.repair_context.frames[0].previous_frame_reference,/^frame:/);assert.ok(!JSON.stringify(plan.result).includes('storage_path'));
  const repaired=await tool('submit_repair_frame',{repair_plan_id:plan.result.repair_plan_id,frame_index:5,format:'png',image_base64:images[8].split(',')[1]});assert.deepEqual(repaired.result.repaired_frame_indexes,[5]);const afterRepairFrames=(await tool('list_frames',{animation_id:animationId})).result;assert.deepEqual(afterRepairFrames.map(frame=>frame.frame_id),beforeRepairFrames.map(frame=>frame.frame_id));assert.notEqual((await toolResponse('get_frame_asset',{frame_id:afterRepairFrames[5].frame_id})).result.content[1].data,badBefore);assert.equal((await toolResponse('get_frame_asset',{frame_id:afterRepairFrames[4].frame_id})).result.content[1].data,neighborBefore);
  const evaluated=await tool('evaluate_repair',{repair_plan_id:plan.result.repair_plan_id});assert.equal(evaluated.result.semantic_status,'needs_reinspection');assert.deepEqual(evaluated.result.repaired_frames,[5]);assert.equal(evaluated.result.technical.passed,true);assert.match(evaluated.result.contact_sheet_reference,/^contact-sheet:/);
  const awaitingSemantic=await tool('get_animation_status',{animation_id:animationId});assert.equal(awaitingSemantic.result.overall_status,'needs_semantic_reinspection');assert.equal(awaitingSemantic.result.current_repair_attempt,1);
  await tool('semantic_validate_animation',{animation_id:animationId,supervisor_result:{passed:true,score:96,issues:[]}});const passedStatus=await tool('get_animation_status',{animation_id:animationId});assert.equal(passedStatus.result.overall_status,'passed');assert.equal(passedStatus.result.export_ready,true);
  const sheet=await tool('build_spritesheet',{id:request.result.attempt_id,frames:8,cols:4});assert.ok(sheet.output_paths.some(p=>p.endsWith('spritesheet.png')));assert.ok(!sheet.output_paths.some(p=>p.endsWith('.tres')));
  const used=await tool('use_result',{id:request.result.attempt_id});assert.equal(used.status,'approved');
  const redo=await tool('redo_animation',{id:request.result.attempt_id});assert.equal(redo.status,'queued');
  console.log('PASS: 21 focused MCP tools; targeted repair, selective replacement, revalidation, semantic reinspection, readiness, and PNG sprite-sheet build.');
}finally{child.stdin.end();await new Promise(resolve=>child.once('exit',resolve));}
const persisted=new Service(root);try{await persisted.init();const run=await persisted.core('workflow/animation/status',{id:animationId});assert.equal(run.repair_history.length,1);assert.deepEqual(run.repair_history[0].repaired_frame_indexes,[5]);assert.equal(typeof run.repair_history[0].new_technical_score,'number');}finally{await persisted.close();}
