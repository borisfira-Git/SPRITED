import {createInterface} from 'node:readline';
import {mcpActions,tools} from './contracts.mjs';
import {randomUUID} from 'node:crypto';
export function startMcp(service) {
  const input=createInterface({input:process.stdin,crlfDelay:Infinity});let initialized=false,queue=Promise.resolve();
  const session_id=randomUUID();let heartbeatTimer;
  const send=(id,result,error)=>process.stdout.write(JSON.stringify(error?{jsonrpc:'2.0',id,error}:{jsonrpc:'2.0',id,result})+'\n');
  async function handle(line){
    let message;
    try{if(line.length>65536)throw new Error();message=JSON.parse(line);}catch{send(null,null,{code:-32700,message:'Parse error'});return;}
    const {id,method,params}=message;
    if(id===undefined)return;
    if(message.jsonrpc!=='2.0'||typeof method!=='string'){send(id,null,{code:-32600,message:'Invalid request'});return;}
    try {
      if(method==='initialize'){
        const agent=String(params?.clientInfo?.name||'MCP client').slice(0,120);
        await service.call('connections/heartbeat',{session_id,agent});clearInterval(heartbeatTimer);
        heartbeatTimer=setInterval(()=>{service.call('connections/heartbeat',{session_id,agent}).catch(()=>{});},30000);heartbeatTimer.unref();
        initialized=true;send(id,{protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'sprited',version:'0.9.0-dev'}});
      } else if(method==='ping')send(id,{});
      else if(!initialized)send(id,null,{code:-32002,message:'Initialize first'});
      else if(method==='tools/list')send(id,{tools});
      else if(method==='tools/call'){
        const action=Object.entries(mcpActions).find(([,s])=>s.tool===params?.name)?.[0];
        if(!action){send(id,null,{code:-32602,message:'Unknown tool'});return;}
        const result=await service.call(action,params.arguments||{});
        const content=[{type:'text',text:JSON.stringify(result)}];
        if(result.success&&['get_character','get_frame_asset','build_contact_sheet'].includes(params.name)){
          const asset=await service.readContentReference(result.result.content_reference);content.push({type:'image',data:asset.bytes.toString('base64'),mimeType:asset.mime_type});
        }
        send(id,{content,structuredContent:result,isError:!result.success});
      }else send(id,null,{code:-32601,message:'Method not found'});
    }catch(error){send(id,null,{code:-32603,message:error.message});}
  }
  input.on('line',line=>{queue=queue.then(()=>handle(line));});
  input.on('close',()=>{clearInterval(heartbeatTimer);queue.then(async()=>{await service.call('connections/disconnect',{session_id});await service.close();}).catch(error=>console.error(error.message));});
}
