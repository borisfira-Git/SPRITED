import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {Service} from '../automation/service.mjs';

const root=path.resolve(process.env.SPRITED_TEST_WORKSPACE);
await mkdir(root,{recursive:true});
const service=new Service(root);
let character,images;
try{
  await service.init();
  images=await service.page.evaluate(()=>Array.from({length:8},(_,i)=>{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');x.clearRect(0,0,64,64);x.fillStyle=`hsl(${i*35} 75% 55%)`;x.fillRect(18+i%3,8,28,48);return c.toDataURL('image/png');}));
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
  const listed=await rpc('tools/list');assert.deepEqual(listed.result.tools.map(t=>t.name),['list_characters','get_character','generate_animation','redo_animation','use_result','build_spritesheet','submit_frame','replace_frame','list_frames','build_gif','validate_animation','detect_bad_frames','validate_loop','get_frame_asset','build_contact_sheet','semantic_validate_frame','semantic_validate_animation']);
  assert.equal((await tool('list_characters')).result.length,1);
  assert.equal((await tool('get_character',{id:character.id})).result.name,'MCP Frame Test');
  const request=await tool('generate_animation',{character_id:character.id,animation_type:'WALKING'});assert.equal(request.status,'queued');
  for(let i=0;i<images.length;i++)await tool('submit_frame',{animation_id:request.result.attempt_id,frame_index:i,format:'png',image_base64:images[i].split(',')[1]});
  let frames=(await tool('list_frames',{animation_id:request.result.attempt_id})).result;assert.equal(frames.length,8);assert.deepEqual(frames.map(f=>f.frame_index),[0,1,2,3,4,5,6,7]);assert.ok(frames.every(f=>f.character_id===character.id&&f.animation_id===request.result.attempt_id&&f.format==='png'&&f.width===64&&f.height===64&&f.created_at&&!('storage_path'in f)));
  const stableId=frames[3].frame_id,createdAt=frames[3].created_at;const replaced=await tool('replace_frame',{animation_id:request.result.attempt_id,frame_id:stableId,format:'png',image_base64:images[4].split(',')[1]});assert.equal(replaced.result.frame_id,stableId);assert.equal(replaced.result.created_at,createdAt);frames=(await tool('list_frames',{animation_id:request.result.attempt_id})).result;assert.equal(frames[3].frame_id,stableId);
  const assetResponse=await toolResponse('get_frame_asset',{frame_id:stableId});assert.equal(assetResponse.result.isError,false);assert.equal(assetResponse.result.content[1].type,'image');assert.equal(assetResponse.result.content[1].mimeType,'image/png');assert.match(assetResponse.result.structuredContent.result.content_reference,/^frame:/);assert.ok(!('storage_path'in assetResponse.result.structuredContent.result));
  const missingAsset=await toolResponse('get_frame_asset',{frame_id:'missing-frame'});assert.equal(missingAsset.result.isError,true);assert.match(missingAsset.result.structuredContent.errors[0],/Frame not found/);
  const contactResponse=await toolResponse('build_contact_sheet',{animation_id:request.result.attempt_id,columns:4,include_frame_numbers:true});assert.equal(contactResponse.result.isError,false);assert.equal(contactResponse.result.content[1].type,'image');assert.equal(contactResponse.result.structuredContent.result.frame_count,8);assert.deepEqual(contactResponse.result.structuredContent.result.ordered_frame_ids,frames.map(frame=>frame.frame_id));assert.ok(!('storage_path'in contactResponse.result.structuredContent.result));
  const gif=await tool('build_gif',{animation_id:request.result.attempt_id,frame_duration_ms:80,loop:true});assert.equal(gif.result.format,'gif');assert.equal(gif.result.frame_count,8);assert.match(gif.result.asset_reference,/^preview:/);assert.ok(!('storage_path'in gif.result));
  const validation=await tool('validate_animation',{animation_id:request.result.attempt_id});assert.equal(validation.result.frame_count,8);assert.ok(Array.isArray(validation.result.issues));const bad=await tool('detect_bad_frames',{animation_id:request.result.attempt_id});assert.equal(bad.result.animation_id,request.result.attempt_id);assert.ok(Array.isArray(bad.result.bad_frames));const loop=await tool('validate_loop',{animation_id:request.result.attempt_id});assert.equal(loop.result.first_frame_index,0);assert.equal(loop.result.last_frame_index,7);
  const semanticFrame=await tool('semantic_validate_frame',{frame_id:stableId,neighboring_frame_ids:[frames[2].frame_id,frames[4].frame_id],supervisor_result:{passed:true,score:93,issues:[]}});assert.equal(semanticFrame.result.validation.frame_id,stableId);assert.equal(semanticFrame.result.validation.passed,true);
  const invalidSemantic=await toolResponse('semantic_validate_frame',{frame_id:stableId,supervisor_result:{passed:true,score:101,issues:[]}});assert.equal(invalidSemantic.result.isError,true);
  const semanticAnimation=await tool('semantic_validate_animation',{animation_id:request.result.attempt_id,supervisor_result:{passed:false,score:44,issues:[{type:'leg_progression',frame_index:5,severity:'high',description:'The same leg remains forward instead of alternating.'}]}});assert.deepEqual(semanticAnimation.result.validation.bad_frames,[5]);assert.equal(semanticAnimation.result.combined_validation.overall_passed,false);
  const sheet=await tool('build_spritesheet',{id:request.result.attempt_id,frames:8,cols:4});assert.ok(sheet.output_paths.some(p=>p.endsWith('spritesheet.png')));assert.ok(!sheet.output_paths.some(p=>p.endsWith('.tres')));
  const used=await tool('use_result',{id:request.result.attempt_id});assert.equal(used.status,'approved');
  const redo=await tool('redo_animation',{id:request.result.attempt_id});assert.equal(redo.status,'queued');
  console.log('PASS: 17 focused MCP tools; safe frame assets, ordered contact sheet, semantic submissions, combined validation, and PNG sprite-sheet build.');
}finally{child.stdin.end();await new Promise(resolve=>child.once('exit',resolve));}
