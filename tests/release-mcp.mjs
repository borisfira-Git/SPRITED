import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const release=path.resolve(process.env.SPRITED_RELEASE || 'outputs/SPRITED-0.7.0');
const child=spawn(process.execPath,[path.join(release,'automation/cli.mjs'),'mcp','--workspace',path.join(release,'demo')]);
let id=0,stderr='';const pending=new Map();child.stderr.on('data',x=>stderr+=x);
createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line);pending.get(m.id)?.(m);});
function request(method,params={}){return new Promise((resolve,reject)=>{const n=++id,t=setTimeout(()=>reject(new Error(stderr||'MCP timed out')),45000);pending.set(n,r=>{clearTimeout(t);pending.delete(n);resolve(r)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n')});}
const report=[];
try {
  assert.equal((await request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'release-check',version:'1'}})).result.serverInfo.version,process.env.SPRITED_EXPECT_VERSION||'0.8.0-preview.2');
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const steps=[
    ['sprited_open_project',{path:'walk.json'}],['sprited_import_video',{path:'walk.webm'}],
    ['sprited_extract_frames',{start:.2,end:1.8,frames:25,max_size:256}],
    ['sprited_remove_background',{}],['sprited_align_frames',{mode:'right_foot'}],['sprited_normalize_frames',{}],
    ['sprited_validate_animation',{}],['sprited_preview_animation',{}],['sprited_build_spritesheet',{cols:5}],
    ['sprited_export_godot',{folder:'godot',cols:5}],['sprited_get_frames',{}],['sprited_get_status',{}]
  ];
  for(const [name,args] of steps){const m=await request('tools/call',{name,arguments:args});const result=m.result?.structuredContent;assert.equal(result?.success,true,JSON.stringify(m));report.push({tool:name,...result});console.log(`PASS ${name}`);}
  assert.equal(report.at(-1).result.frame_count,25);
  assert.ok(Math.abs(report.at(-1).result.duration_ms-1600)<.001);
  assert.equal(report.find(r=>r.tool==='sprited_build_spritesheet').result.vertical_frames,5);
  assert.equal(report.find(r=>r.tool==='sprited_validate_animation').warnings.length,0);
  await writeFile(path.join(release,'RELEASE-TEST.json'),JSON.stringify({passed:true,tests:report},null,2));
}finally {child.stdin.end();await new Promise(r=>child.once('exit',r));}
