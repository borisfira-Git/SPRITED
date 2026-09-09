import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {Service} from '../automation/service.mjs';
import {serve} from '../automation/http.mjs';
const root=path.resolve(process.env.SPRITED_TEST_WORKSPACE);
await mkdir(root,{recursive:true});
const fixture=await readFile(process.env.SPRITED_TEST_VIDEO);
await writeFile(path.join(root,'walk.webm'),fixture);
await writeFile(path.join(root,'walk.json'),JSON.stringify({character:'Fixture',animation:'walk',source_video:'walk.webm',target_frames:8,background:'#00ff00',alignment:'right_foot',frame_size:[256,256]}));
const service=new Service(root);let http;
async function call(action,args={}){const r=await service.call(action,args);assert.equal(r.success,true,JSON.stringify(r));return r;}
try {
  await service.init();
  await call('project/open',{path:'walk.json'});
  assert.equal((await call('status')).result.alignment,'rightFoot');
  await call('video/extract',{start:0,end:2,frames:8,max_size:256});
  assert.equal((await call('status')).result.frame_count,8);
  const before=await call('frames/get');
  assert.equal((await service.call('video/extract',{start:2,end:1,frames:8})).success,false);
  assert.deepEqual((await call('frames/get')).result,before.result,'failed operation rolls back');
  await call('frames/remove-background');await call('frames/align',{mode:'right_foot'});await call('frames/normalize');
  const validation=await call('animation/validate');assert.equal(validation.result.frames.length,8);assert.equal(validation.warnings.length,0);
  const frameData=(await call('frames/get')).result;
  assert.ok(frameData.every(f=>f.bodyAligned&&f.alignmentMode==='rightFoot'));
  assert.equal(new Set(frameData.map(f=>f.scale)).size,1);
  const built=await call('spritesheet/build',{cols:4});
  assert.equal(built.result.horizontal_frames,4);assert.equal(built.result.vertical_frames,2);
  const png=await readFile(built.output_paths[0]);assert.equal(png.subarray(1,4).toString(),'PNG');
  assert.equal(png.readUInt32BE(16),1024);assert.equal(png.readUInt32BE(20),512);
  const godot=await call('export/godot',{cols:4,folder:'godot'});
  const resource=await readFile(godot.output_paths.find(p=>p.endsWith('.tres')),'utf8');
  assert.equal((resource.match(/type="AtlasTexture"/g)||[]).length,8);assert.match(resource,/"speed": 1.0/);
  await call('animation/preview');
  await call('project/open',{path:built.output_paths.find(p=>p.endsWith('manifest.json'))});
  assert.equal((await call('status')).result.frame_count,8,'exported project reopens');
  for(const attempt of [()=>service.call('project/open',{path:'../outside.json'}),()=>service.call('export/godot',{folder:'../outside'}),()=>service.call('status',{unexpected:true}),()=>service.call('constructor',{}),()=>service.call('status',JSON.parse('{"__proto__":{}}'))])assert.equal((await attempt()).success,false);
  http=await serve(service,0,'test-token');
  const base=`http://127.0.0.1:${http.port}`;
  assert.equal((await fetch(`${base}/status`)).status,403);
  assert.equal((await fetch(`${base}/status`,{headers:{authorization:'Bearer test-token',origin:'https://example.org'}})).status,403);
  const response=await fetch(`${base}/status`,{headers:{authorization:'Bearer test-token'}});assert.equal(response.status,200);assert.equal((await response.json()).result.frame_count,8);
  const post=await fetch(`${base}/animation/validate`,{method:'POST',headers:{authorization:'Bearer test-token','content-type':'application/json'},body:'{}'});assert.equal(post.status,200);
  console.log('PASS: shared-core pipeline, persistence, rollback, export reopen, PNG dimensions, Godot resource structure, path confinement, HTTP authentication and Origin rejection.');
}finally{if(http)await new Promise(r=>http.server.close(r));await service.close();}
// Real stdio MCP client handshake and tools against the persisted project.
const child=spawn(process.execPath,[new URL('../automation/cli.mjs',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),'mcp','--workspace',root],{stdio:['pipe','pipe','pipe']});
let stderr='',next=0;child.stderr.on('data',d=>stderr+=d);const pending=new Map();
const lines=createInterface({input:child.stdout});
lines.on('line',line=>{const m=JSON.parse(line);pending.get(m.id)?.(m);pending.delete(m.id);});
function request(method,params={}){const id=++next;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`MCP timeout ${method}: ${stderr}`)),30000);pending.set(id,m=>{clearTimeout(timer);resolve(m)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
try {
  const initialized=await request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'sprited-test',version:'1'}});
  assert.equal(initialized.result.serverInfo.name,'sprited');
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const list=await request('tools/list');assert.equal(list.result.tools.length,12);
  const status=await request('tools/call',{name:'sprited_get_status',arguments:{}});assert.equal(status.result.structuredContent.result.frame_count,8);
  const check=await request('tools/call',{name:'sprited_validate_animation',arguments:{}});assert.equal(check.result.isError,false);
  const bad=await request('tools/call',{name:'sprited_open_project',arguments:{path:'../outside.json'}});assert.equal(bad.result.isError,true);
  const build=await request('tools/call',{name:'sprited_build_spritesheet',arguments:{cols:4}});assert.equal(build.result.structuredContent.success,true);
  console.log('PASS: MCP initialize, tools/list, structured status, validation, safe error, sheet export.');
}finally {child.stdin.end();await new Promise(resolve=>child.once('exit',resolve));}
