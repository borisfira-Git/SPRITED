import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import '../public/character-workflow.js';
import {Service} from '../automation/service.mjs';
import {serve} from '../automation/http.mjs';
import {tools} from '../automation/contracts.mjs';
const W=globalThis.SpritedWorkflow;
assert.equal(W.recipes().length,6);assert.equal(W.recipes().find(r=>r.animation_type==='WALKING').motion_template.phases.length,8);
assert.deepEqual(W.hydrate(undefined),W.empty());
const root=path.resolve(process.env.SPRITED_TEST_WORKSPACE);await mkdir(root,{recursive:true});
await writeFile(path.join(root,'walk.webm'),await readFile(process.env.SPRITED_TEST_VIDEO));
let service=new Service(root),http;
async function call(action,args={}){const r=await service.call(action,args);assert.equal(r.success,true,JSON.stringify(r));return r.result;}
let runId;
try {
  await service.init();
  // Make an explicitly synthetic reference for plumbing tests, never a generation benchmark.
  const ref=await service.page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=64;const x=c.getContext('2d');x.fillStyle='red';x.fillRect(20,8,24,52);return c.toDataURL();});
  await writeFile(path.join(root,'fixture.png'),Buffer.from(ref.split(',')[1],'base64'));
  const c=await call('character/set-reference',{path:'fixture.png',name:'Fixture'});
  assert.equal(c.name,'Fixture');
  const run=await call('animation/create',{animation_type:'WALKING'});runId=run.id;
  await call('animation/configure',{id:run.id,source_frames:25,output_frames:8,start:0,end:2,canvas_width:256,canvas_height:256});
  const decision=await call('animation/route',{id:run.id});assert.equal(decision.selected_provider,'agent_router');
  const queued=await call('animation/process',{id:run.id});assert.equal(queued.status,'queued');
  assert.equal((await service.call('animation/approve',{id:run.id})).success,false);
  await call('animation/submit-result',{id:run.id,path:'walk.webm',provider:'test-fixture-NOT-AI'});
  const result=await call('animation/process',{id:run.id});assert.equal(result.status,'validated');assert.equal(result.source_frame_count,25);assert.equal(result.output_frames_paths.length,8);
  assert.equal((await call('status')).frame_count,0,'processing preserves editor');
  await call('animation/open',{id:run.id});assert.equal((await call('status')).frame_count,8);
  const sheet=await call('spritesheet/build',{cols:4});assert.equal(sheet.frames,8);
  const exported=await service.call('export/godot',{cols:4});assert.equal(exported.success,true);assert.ok(exported.output_paths.some(p=>p.endsWith('animation.tres')));
  await call('animation/approve',{id:run.id});
  const learned=await call('animation/create',{animation_type:'WALKING'});assert.equal(learned.options.end,2);
  await call('animation/configure',{id:learned.id,source_mode:'stub'});
  assert.equal((await service.call('animation/process',{id:learned.id})).success,false);
  assert.equal((await call('animation/status',{id:learned.id})).status,'failed');
  assert.equal((await call('status')).frame_count,8,'failed stub preserves editor');
  await call('animation/reject',{id:run.id});assert.equal((await call('animation/status',{id:run.id})).status,'rejected');
  const retry=await call('animation/regenerate',{id:run.id});assert.equal(retry.parent_run_id,run.id);assert.equal(retry.source_video_path,null);
  http=await serve(service,0,'workflow-test');const url=`http://127.0.0.1:${http.port}`;
  const api=await fetch(url+'/generation-runs/'+run.id,{headers:{authorization:'Bearer workflow-test'}});assert.equal(api.status,200);assert.equal((await api.json()).result.id,run.id);
  const post=await fetch(url+'/generation-runs/'+retry.id+'/route',{method:'POST',headers:{authorization:'Bearer workflow-test'},body:'{}'});assert.equal(post.status,200);assert.equal((await post.json()).result.selected_provider,'agent_router');
  const saved=await service.core('snapshot');await writeFile(path.join(root,'saved.spriteproject'),JSON.stringify(saved));
  await call('project/open',{path:'saved.spriteproject'});assert.equal((await call('character/show')).reference_image,ref);
  const old={...saved};delete old.workflow;await writeFile(path.join(root,'old.spriteproject'),JSON.stringify(old));await call('project/open',{path:'old.spriteproject'});assert.equal(await call('character/show'),null);assert.deepEqual(await call('animation/list'),[]);
  await call('project/open',{path:'saved.spriteproject'});
} finally {if(http)await new Promise(r=>http.server.close(r));await service.close();}
// Real process boundary: CLI and MCP, using durable state.
const cli=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['automation/cli.mjs','animation','status',runId,'--workspace',root,'--json']);let out='';p.stdout.on('data',b=>out+=b);p.on('error',reject);p.on('exit',code=>code?reject(Error(out)):resolve(JSON.parse(out)));});assert.equal(cli.result.id,runId);
const p=spawn(process.execPath,['automation/cli.mjs','mcp','--workspace',root]);let seq=0;const waiting=new Map();const lines=createInterface({input:p.stdout});lines.on('line',line=>{const m=JSON.parse(line);waiting.get(m.id)?.(m);waiting.delete(m.id);});
const rpc=(method,params)=>new Promise(resolve=>{const id=++seq;waiting.set(id,resolve);p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
try {await rpc('initialize',{});const listed=await rpc('tools/list',{});assert.equal(listed.result.tools.length,tools.length);const r=await rpc('tools/call',{name:'sprited_get_generation_status',arguments:{id:runId}});assert.equal(r.result.structuredContent.result.id,runId);}finally{p.stdin.end();await new Promise(r=>p.on('exit',r));}
console.log('PASS character persistence, 6 recipes, routing, agent submission, manual 25→8 pipeline, editor preservation, PNG/Godot export, memory, reject/retry, stub failure, old projects, CLI, API and MCP');
