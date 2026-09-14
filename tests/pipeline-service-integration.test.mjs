import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Service} from '../automation/service.mjs';

test('SPRITED service owns a complete direct-frame pipeline without Codex or MCP',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'sprited-pipeline-'));let service;
  try{
    await writeFile(path.join(root,'.placeholder'),'');service=await new Service(root).init();const data=await service.page.evaluate(()=>[40,70,100,130,160,130,100,70].map(value=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const context=canvas.getContext('2d');context.clearRect(0,0,64,64);context.fillStyle=`rgb(${value} ${value} ${value})`;context.fillRect(18,8,28,48);return canvas.toDataURL('image/png');})),frames=data.map(src=>Buffer.from(src.split(',')[1],'base64'));
    await writeFile(path.join(root,'guardian.png'),frames[0]);const character=(await service.call('character/create',{path:'guardian.png',name:'Pipeline Guardian'})).result,calls=[];
    service.imageProviders.cloudflare_flux={id:'cloudflare_flux',config:{enabled:true},status:()=>({available:true,health:'ready'}),generate_frame:async request=>{calls.push(['generate',request.frame_index]);return {bytes:frames[request.frame_index],format:'png',mime_type:'image/png',provider:'cloudflare_flux',provider_metadata:{output_count:1}};},edit_frame:async request=>{calls.push(['edit',request.frame_index]);return {bytes:frames[request.frame_index],format:'png',mime_type:'image/png',provider:'cloudflare_flux',provider_metadata:{output_count:1}};}};
    service.providerPolicy={default_provider:'cloudflare_flux',fallback_providers:[],allow_paid_providers:true,allow_automatic_paid_fallback:false,require_confirmation_for_paid_request:true,max_paid_image_generations_per_animation:20,max_paid_repair_generations_per_animation:3};
    const result=await service.call('pipeline/run',{character_id:character.id,animation_type:'WALKING',frames:8,cols:4,provider:'cloudflare_flux',repair_intelligence:'sprited_only',confirm_paid_request:true});assert.equal(result.success,true,JSON.stringify(result));assert.equal(result.status,'ready');assert.equal(calls.filter(item=>item[0]==='generate').length,8);const run=await service.core('workflow/animation/status',{id:result.result.animation_id});assert.equal(run.frame_records.length,8);assert.equal(new Set(run.frame_records.map(frame=>frame.frame_id)).size,8);assert.equal(run.technical_validation.passed,true);assert.equal(run.technical_validation.loop_validation.passed,true);assert.equal(run.gif_previews.length,1);assert.equal(run.spritesheets.length,1);const sheet=run.spritesheets[0].output_paths.find(file=>file.endsWith('spritesheet.png'));await stat(path.isAbsolute(sheet)?sheet:path.join(root,sheet));
    const approved=await service.call('agent/use-result',{id:run.id});assert.equal(approved.success,true);assert.equal(approved.status,'approved');const cleaned=await service.core('workflow/animation/status',{id:run.id});assert.equal(cleaned.user_approved,true);assert.equal(cleaned.storage_state,'cleaned');assert.equal(cleaned.cleanup_pending,false);await stat(path.isAbsolute(cleaned.sprite_sheet_path)?cleaned.sprite_sheet_path:path.join(root,cleaned.sprite_sheet_path));assert.equal(JSON.parse(await readFile(path.join(root,'.sprited','experience-history.json'),'utf8')).version,1);
  }finally{await service?.close();await rm(root,{recursive:true,force:true});}
});
