import test from 'node:test';
import assert from 'node:assert/strict';
import {tools} from '../automation/contracts.mjs';
import {createMcpSession} from '../automation/mcp.mjs';

test('local MCP exposes the video-to-sprite control plane',()=>{
  const names=new Set(tools.map(tool=>tool.name));
  for(const name of ['generate_animation','upload_video','extract_frames','remove_background','build_spritesheet','export_sprite_asset','list_character_profiles','get_character_history'])assert.ok(names.has(name),`${name} is missing`);
  assert.ok(names.has('generate_direct_frame_animation'));
  assert.ok(names.has('build_direct_frame_spritesheet'));
});

test('generate_animation maps to the external-video pipeline rather than the legacy frame generator',async()=>{
  const calls=[],service={call:async(action,args)=>{calls.push({action,args});return {success:true,status:'ready',result:{},warnings:[],errors:[],output_paths:[]};}};
  const session=createMcpSession(service,{sessionId:'video-test'});
  await session.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{clientInfo:{name:'test'}}});
  const reply=await session.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'generate_animation',arguments:{character_id:'hero',prompt:'walk',animation_type:'WALKING',frames:8}}});
  assert.equal(reply.result.isError,false);
  assert.equal(calls.at(-1).action,'agent/generate-video-animation');
  await session.close();
});
