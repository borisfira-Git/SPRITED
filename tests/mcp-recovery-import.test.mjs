import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Service} from '../automation/service.mjs';
import {createMcpSession} from '../automation/mcp.mjs';

const root=await mkdtemp(path.join(os.tmpdir(),'sprited-recovery-import-'));
let service,session;
try{
  service=await new Service(root).init();session=createMcpSession(service);
  const rpc=async(method,params={})=>session.handle({jsonrpc:'2.0',id:Math.random(),method,params});
  await rpc('initialize',{clientInfo:{name:'recovery-import-test'}});
  const listed=await rpc('tools/list');
  assert.equal(listed.result.tools.length,33);
  const tool=listed.result.tools.find(item=>item.name==='create_attempt_from_spritesheet');
  assert.deepEqual(tool._meta,{'openai/fileParams':['source_image']});
  assert.ok(tool.inputSchema.properties.source_image.anyOf[0].properties.download_url);
  const sheet=await service.page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const c=canvas.getContext('2d');for(let row=0;row<2;row++)for(let col=0;col<4;col++){c.fillStyle=`rgb(${col*50},${row*100},${(col+1)*20})`;c.fillRect(col*64,row*128,64,128);}return canvas.toDataURL('image/png');});
  const character=await service.call('agent/register-character',{name:'Recovery Test',id:'recovery-character',reference_image:sheet});
  const imported=await rpc('tools/call',{name:'create_attempt_from_spritesheet',arguments:{character_id:'recovery-character',animation_type:'WALKING',source_image:sheet,rows:2,columns:4,frame_count:8,frame_order:[1,2,3,4,5,6,7,8],canvas_width:16,canvas_height:16,background_mode:'keep'}});
  assert.equal(imported.result.isError,false,JSON.stringify(imported));
  const attempt=imported.result.structuredContent.result;assert.ok(attempt.attempt_id);assert.equal(attempt.extracted_frame_count,8);assert.equal(attempt.debug_snapshot.frames_persisted,true);
  const frames=await rpc('tools/call',{name:'list_frames',arguments:{animation_id:attempt.attempt_id}});assert.equal(frames.result.structuredContent.result.length,8);
  const status=await rpc('tools/call',{name:'get_animation_status',arguments:{animation_id:attempt.attempt_id}});assert.equal(status.result.isError,false);
  const validation=await rpc('tools/call',{name:'validate_animation',arguments:{animation_id:attempt.attempt_id}});assert.equal(validation.result.isError,false,JSON.stringify(validation));
  const playback=await rpc('tools/call',{name:'inspect_playback',arguments:{animation_id:attempt.attempt_id}});assert.equal(playback.result.isError,false,JSON.stringify(playback));
  const loop=await rpc('tools/call',{name:'validate_loop',arguments:{animation_id:attempt.attempt_id}});assert.equal(loop.result.isError,false,JSON.stringify(loop));
  const built=await rpc('tools/call',{name:'build_spritesheet',arguments:{id:attempt.attempt_id,frames:8,cols:8}});assert.equal(built.result.isError,false,JSON.stringify(built));
  const output=built.result.structuredContent.output_paths.find(item=>item.endsWith('spritesheet.png'));assert.ok(output);const info=await stat(output);assert.ok(info.size>8);assert.equal((await readFile(output)).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  await session.close();session=null;await service.close();service=null;service=await new Service(root).init();
  const afterRestart=await service.call('agent/list-frames',{animation_id:attempt.attempt_id});assert.equal(afterRestart.success,true);assert.equal(afterRestart.result.length,8);
  console.log('PASS: recovery file bridge, 4x2 slicing, persisted attempt, validation, playback, loop, restart, and PNG export');
}finally{await session?.close().catch(()=>{});await service?.close().catch(()=>{});await rm(root,{recursive:true,force:true});}
