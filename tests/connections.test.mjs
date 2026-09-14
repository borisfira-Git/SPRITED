import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Connections} from '../automation/connections.mjs';
import {Service} from '../automation/service.mjs';
test('only the selected client heartbeat is live; switching invalidates the previous client',()=>{let now=0;const c=new Connections(()=>now,90000);assert.equal(c.status().server_ready,true);assert.equal(c.status().external_agent_connected,false);c.select('codex');c.heartbeat({session_id:'inactive',agent:'cline:Cline'});assert.equal(c.status().external_agent_connected,false);c.heartbeat({session_id:'active',agent:'codex:Codex'});assert.equal(c.status().overall,'AI READY');assert.equal(c.status().generation_capability_verified,false);c.select('cline');assert.equal(c.status().active_external_client,'cline');assert.equal(c.status().external_agent_connected,false);c.heartbeat({session_id:'old',agent:'codex:Codex'});assert.equal(c.status().external_agent_connected,false);c.heartbeat({session_id:'new',agent:'cline:Cline'});assert.equal(c.status().external_agent_connected,true);now=90000;assert.equal(c.status().overall,'AI OFFLINE');});
test('selected external client is persisted without session or token data',async()=>{const stateDir=await mkdtemp(path.join(os.tmpdir(),'sprited-connections-')),service={stateDir,connectionStatePath:path.join(stateDir,'connections.json'),connections:new Connections()};await Service.prototype.selectExternalClient.call(service,'codex');assert.deepEqual(JSON.parse(await readFile(service.connectionStatePath,'utf8')),{active_external_client:'codex'});});
