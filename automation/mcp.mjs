import {createInterface} from 'node:readline';
import {mcpActions,tools} from './contracts.mjs';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {chatgptTools,ChatGptAppAdapter} from './chatgpt-app.mjs';

export const MCP_PROTOCOL_VERSION='2025-06-18';
export const MCP_SERVER_INFO={name:'sprited',title:'SPRITED Animation Agent',version:'0.13.0-dev'};
export const MCP_INSTRUCTIONS='SPRITED turns character references and generated PNG/WebP SpriteSheets into ordered, validated game animation. For every spritesheet, walk cycle, animation, generation, inspection, or repair request, invoke the SPRITED tool first. SPRITED must create an attempt_id and run Preflight/Strategy Router, Motion Blueprint, Motion Lock, generation or repair, Temporal Inspector, Rejected Pattern Memory, Experience Learning, Process Supervisor, and Debug Snapshot before returning a result. Do not generate animation directly outside SPRITED and do not label unverified output as SPRITED. Use prepare_animation_prompt or analyze_spritesheet first, then validate, repair only reported frames, and export only after SPRITED approval. Never request local paths, credentials, or secrets.';

export function createMcpSession(service,{sessionId=randomUUID(),plugin=false}={}){
  let initialized=false,heartbeatTimer=null,agent='MCP client';const app=plugin?new ChatGptAppAdapter(service):null,availableTools=plugin?chatgptTools:tools;
  const response=(id,result,error)=>error?{jsonrpc:'2.0',id,error}:{jsonrpc:'2.0',id,result};
  async function touch(){if(plugin&&typeof service.pluginHeartbeat==='function')await service.pluginHeartbeat({session_id:sessionId,agent});}
  async function handle(message){
    const {id,method,params}=message||{};
    if(message?.jsonrpc!=='2.0'||typeof method!=='string')return response(id??null,null,{code:-32600,message:'Invalid request'});
    try{
      if(method==='initialize'){
        agent=String(params?.clientInfo?.name||'MCP client').slice(0,100);
        if(plugin)await service.pluginConnect({session_id:sessionId,agent});else {
          const identity=`${process.env.SPRITED_CLIENT||''}:${agent}`.slice(0,120);await service.call('connections/heartbeat',{session_id:sessionId,agent:identity});clearInterval(heartbeatTimer);heartbeatTimer=setInterval(()=>service.call('connections/heartbeat',{session_id:sessionId,agent:identity}).catch(()=>{}),30000);heartbeatTimer.unref();
        }
        initialized=true;return response(id,{protocolVersion:MCP_PROTOCOL_VERSION,capabilities:{tools:{listChanged:false}},serverInfo:MCP_SERVER_INFO,instructions:MCP_INSTRUCTIONS});
      }
      if(method==='ping'){await touch();return response(id,{});}
      if(!initialized)return response(id,null,{code:-32002,message:'Initialize first'});
      await touch();
      if(method==='notifications/initialized'||method==='notifications/cancelled')return null;
      if(method==='tools/list')return response(id,{tools:availableTools});
      if(method==='tools/call'){
        if(plugin){const spec=availableTools.find(tool=>tool.name===params?.name);if(!spec)return response(id,null,{code:-32602,message:'Unknown tool'});const result=await app.call(params.name,params.arguments||{}),content=[];let structured=structuredClone(result);const reference=structured.asset_reference;delete structured.asset_reference;if(structured.download){const file=await readFile(structured.download.path);content.push({type:'resource',resource:{uri:`sprited://download/${encodeURIComponent(structured.download.filename)}`,mimeType:structured.download.mime_type,blob:file.toString('base64')}});delete structured.download;}if(reference){const asset=await service.readContentReference(reference);content.push({type:'image',data:asset.bytes.toString('base64'),mimeType:asset.mime_type});}content.unshift({type:'text',text:JSON.stringify(structured)});return response(id,{content,structuredContent:structured,isError:structured.success===false});}
        const action=Object.entries(mcpActions).find(([,spec])=>spec.tool===params?.name)?.[0];if(!action)return response(id,null,{code:-32602,message:'Unknown tool'});
        const result=await service.call(action,params.arguments||{}),content=[{type:'text',text:JSON.stringify(result)}];
        if(result.success&&['get_character','get_frame_asset','build_contact_sheet'].includes(params.name)){const asset=await service.readContentReference(result.result.content_reference);content.push({type:'image',data:asset.bytes.toString('base64'),mimeType:asset.mime_type});}
        return response(id,{content,structuredContent:result,isError:!result.success});
      }
      return response(id,null,{code:-32601,message:'Method not found'});
    }catch(error){return response(id,null,{code:-32603,message:error.message||String(error)});}
  }
  async function close(){clearInterval(heartbeatTimer);if(plugin&&typeof service.pluginDisconnect==='function')await service.pluginDisconnect({session_id:sessionId,agent});else await service.call('connections/disconnect',{session_id:sessionId}).catch(()=>{});}
  return {sessionId,handle,close};
}

export function startMcp(service){
  const input=createInterface({input:process.stdin,crlfDelay:Infinity}),session=createMcpSession(service);let queue=Promise.resolve();
  const send=message=>{if(message)process.stdout.write(JSON.stringify(message)+'\n');};
  async function handleLine(line){let message;try{if(line.length>65536)throw Error();message=JSON.parse(line);}catch{return send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});}send(await session.handle(message));}
  input.on('line',line=>{queue=queue.then(()=>handleLine(line));});
  input.on('close',()=>{queue.then(async()=>{await session.close();await service.close();}).catch(error=>console.error(error.message));});
}
