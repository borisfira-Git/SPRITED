import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityService} from '../automation/activity-service.mjs';
import {MCP_INSTRUCTIONS,MCP_SERVER_INFO,createMcpSession} from '../automation/mcp.mjs';
import {tools} from '../automation/contracts.mjs';
import {serve} from '../automation/http.mjs';

test('activity history persists and produces human-readable learning summaries',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'sprited-activity-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'activity'));
  const experienceService={query_relevant_experience:()=>[{animation_type:'WALKING',issue_type:'leg_progression',repair_action:'neighbor_continuity',repair_succeeded:true,technical_score_before:68,technical_score_after:89,relevance:9}]};
  let activity=await new ActivityService({logPath:path.join(root,'activity','activity-log.jsonl'),experienceService}).init();await activity.record({event_type:'repair_succeeded',animation_type:'WALKING',character_id:'guardian',attempt_id:'walk-1',frame_index:4,issue_type:'leg_progression',strategy:'neighbor_continuity',score_before:68,score_after:89,success:true,summary:'Frame 5 improved using neighboring frames.'});
  activity=await new ActivityService({logPath:path.join(root,'activity','activity-log.jsonl'),experienceService}).init();const summary=activity.summary({animation_type:'WALKING'});assert.equal(summary.repair_outcomes.success_rate,100);assert.match(summary.recent[0].summary,/Frame 5/);assert.equal(activity.animationLessons({animation_type:'WALKING'})[0].strategy,'neighbor_continuity');assert.equal(JSON.stringify(summary).includes(root),false);
});

test('desktop MCP metadata preserves existing development tools',()=>{
  const names=tools.map(tool=>tool.name);for(const name of ['list_characters','get_character','generate_animation','build_gif','build_spritesheet','prepare_assisted_request','get_animation_status'])assert.ok(names.includes(name));assert.deepEqual(names.slice(-3),['get_experience_summary','get_recent_changes','get_animation_lessons']);for(const tool of tools){assert.ok(tool.title);assert.equal(typeof tool.annotations.readOnlyHint,'boolean');assert.equal(typeof tool.annotations.destructiveHint,'boolean');assert.equal(typeof tool.annotations.openWorldHint,'boolean');assert.ok(tool.outputSchema);}assert.equal(MCP_SERVER_INFO.title,'SPRITED Animation Agent');assert.match(MCP_INSTRUCTIONS,/SPRITED turns character references/);
});

test('shared MCP session routes ChatGPT quality calls into existing SPRITED services',async()=>{
  const calls=[],service={pluginConnect:async()=>{},pluginHeartbeat:async()=>{},pluginDisconnect:async()=>{},call:async(action,args)=>{calls.push([action,args]);return {success:true,status:'GOOD_ENOUGH',result:{animation_id:'walk-1',quality_state:'GOOD_ENOUGH'},warnings:[],errors:[],output_paths:[],next_suggested_action:'export'};}},session=createMcpSession(service,{plugin:true,sessionId:'session-1'});
  const initialized=await session.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{clientInfo:{name:'ChatGPT'}}});assert.equal(initialized.result.serverInfo.name,'sprited');assert.ok(initialized.result.instructions);const listed=await session.handle({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});assert.equal(listed.result.tools.length,11);const result=await session.handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'evaluate_quality',arguments:{animation_id:'walk-1'}}});assert.equal(result.result.isError,false);assert.deepEqual(calls,[['agent/get-animation-status',{animation_id:'walk-1'}]]);await session.close();
});

test('authenticated Streamable HTTP MCP endpoint initializes, discovers and calls tools',async t=>{
  const token='plugin-test-token',root=await mkdtemp(path.join(tmpdir(),'sprited-plugin-http-'));t.after(()=>rm(root,{recursive:true,force:true}));const calls=[],service={root,pluginConnect:async()=>{},pluginHeartbeat:async()=>{},pluginDisconnect:async()=>{},call:async(action,args)=>{calls.push([action,args]);return {success:true,status:'ok',result:action==='agent/list-characters'?[{id:'guardian',name:'Guardian'}]:{},warnings:[],errors:[],output_paths:[],next_suggested_action:null};}};
  const running=await serve(service,0,token);t.after(()=>new Promise(resolve=>running.server.close(resolve)));const endpoint=`http://127.0.0.1:${running.port}/mcp`,headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
  assert.equal((await fetch(endpoint,{method:'POST',headers:{...headers,authorization:'Bearer wrong'},body:'{}'})).status,403);const init=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',clientInfo:{name:'ChatGPT',version:'1'}}})}),sessionId=init.headers.get('mcp-session-id'),initialized=await init.json();assert.equal(init.status,200);assert.ok(sessionId);assert.equal(initialized.result.serverInfo.version,'0.13.0-dev');assert.equal(JSON.stringify(initialized).includes(token),false);
  const mcpHeaders={...headers,'mcp-session-id':sessionId};
  const listed=await fetch(endpoint,{method:'POST',headers:mcpHeaders,body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})}).then(response=>response.json());assert.equal(listed.result.tools.length,11);
  const callMessage={jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'get_learning_summary',arguments:{}}};
  const called=await fetch(endpoint,{method:'POST',headers:mcpHeaders,body:JSON.stringify(callMessage)}).then(response=>response.json());assert.equal(called.result.structuredContent.success,true);assert.deepEqual(calls,[['agent/get-experience-summary',{}]]);
  assert.equal(await fetch(endpoint,{method:'GET',headers:mcpHeaders}).then(response=>response.status),405);assert.equal(await fetch(endpoint,{method:'DELETE',headers:mcpHeaders}).then(response=>response.status),204);
});
