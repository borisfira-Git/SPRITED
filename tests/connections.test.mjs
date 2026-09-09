import test from 'node:test';
import assert from 'node:assert/strict';
import {Connections} from '../automation/connections.mjs';
test('server alone is offline; heartbeat is live, expires and is removable',()=>{let now=0;const c=new Connections(()=>now,90000);assert.equal(c.status().server_ready,true);assert.equal(c.status().external_agent_connected,false);c.heartbeat({session_id:'a',agent:'test client'});assert.equal(c.status().overall,'AI READY');assert.equal(c.status().generation_capability_verified,false);now=90000;assert.equal(c.status().overall,'AI OFFLINE');c.heartbeat({session_id:'b',agent:'test client'});c.disconnect({session_id:'b'});assert.equal(c.status().external_agent_connected,false);});
