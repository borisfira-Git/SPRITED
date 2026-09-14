import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {serve} from '../automation/http.mjs';
import {actions} from '../automation/contracts.mjs';

test('authenticated local setup endpoint configures a client without becoming an MCP tool or disclosing its token',async()=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'sprited-config-http-'));await mkdir(path.join(home,'.cline','data','settings'),{recursive:true});const file=path.join(home,'.cline','data','settings','cline_mcp_settings.json');await writeFile(file,JSON.stringify({mcpServers:{'godot-ai':{command:'godot'}}}));
  let selected=null;const token='http-test-secret',running=await serve({root:home,selectExternalClient:async client=>{selected=client;}},0,token,{clientHome:home});try{const response=await fetch(`http://127.0.0.1:${running.port}/connections/configure`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({client:'cline'})}),body=await response.json(),saved=JSON.parse(await readFile(file,'utf8'));assert.equal(body.success,true);assert.equal(body.result.token_synchronized,true);assert.equal(JSON.stringify(body).includes(token),false);assert.deepEqual(saved.mcpServers['godot-ai'],{command:'godot'});assert.equal(saved.mcpServers.sprited.env.SPRITED_TOKEN,token);assert.equal(selected,'cline');assert.equal(Object.hasOwn(actions,'connections/configure'),false);}finally{await new Promise(resolve=>running.server.close(resolve));}
});
