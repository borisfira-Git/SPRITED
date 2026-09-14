import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {Service} from '../automation/service.mjs';
import {serve} from '../automation/http.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XyVZ5wAAAABJRU5ErkJggg==','base64');

test('authenticated localhost MCP proxy returns character content and rejects arbitrary references',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'sprited-content-proxy-')),token='content-test-token';let service,http,child;
  try{
    await writeFile(path.join(root,'guardian.png'),png);service=await new Service(root).init();const created=await service.call('character/create',{path:'guardian.png',name:'Guardian Proxy'});http=await serve(service,0,token);
    child=spawn(process.execPath,[path.resolve('automation/cli.mjs'),'mcp','--api',`http://127.0.0.1:${http.port}`],{env:{...process.env,SPRITED_TOKEN:token},stdio:['pipe','pipe','pipe']});const pending=new Map();let id=0,stderr='';child.stderr.on('data',data=>stderr+=data);createInterface({input:child.stdout}).on('line',line=>{const message=JSON.parse(line);pending.get(message.id)?.(message);pending.delete(message.id);});const rpc=(method,params={})=>new Promise((resolve,reject)=>{const requestId=++id,timer=setTimeout(()=>reject(Error(stderr||'MCP timeout')),15000);pending.set(requestId,message=>{clearTimeout(timer);resolve(message);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:requestId,method,params})+'\n');});
    await rpc('initialize',{clientInfo:{name:'content-proxy-test'}});const listed=await rpc('tools/call',{name:'list_characters',arguments:{}});assert.equal(listed.result.structuredContent.result.length,1);const got=await rpc('tools/call',{name:'get_character',arguments:{id:created.result.id}});assert.equal(got.result.isError,false);assert.equal(got.result.content[1].type,'image');assert.equal(got.result.structuredContent.result.name,'Guardian Proxy');const publicJson=JSON.stringify(got);for(const key of ['reference_image_path','storage_path',root])assert.equal(publicJson.includes(key),false);
    const missing=await rpc('tools/call',{name:'get_character',arguments:{id:'missing'}});assert.equal(missing.result.isError,true);const traversal=await fetch(`http://127.0.0.1:${http.port}/content/character/../../guardian.png`,{headers:{authorization:`Bearer ${token}`}});assert.notEqual(traversal.status,200);const unauthenticated=await fetch(`http://127.0.0.1:${http.port}/content/character/${created.result.id}`);assert.equal(unauthenticated.status,403);
  }finally{if(child){child.stdin.end();await new Promise(resolve=>child.once('exit',resolve));}if(http)await new Promise(resolve=>http.server.close(resolve));await service?.close();await rm(root,{recursive:true,force:true});}
});
