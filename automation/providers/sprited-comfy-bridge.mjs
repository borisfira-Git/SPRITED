import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const imageFormat=(bytes,filename,type='')=>bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':bytes.length>=12&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'webp':type.includes('webp')||path.extname(filename).toLowerCase()==='.webp'?'invalid-webp':'invalid';
const localEndpoint=value=>{const url=new URL(value);if(url.protocol!=='http:'||!['127.0.0.1','localhost','::1','[::1]'].includes(url.hostname))throw Error('ComfyUI endpoint must be local HTTP');return url.origin;};
const fetchWithin=async(url,options,deadline)=>{const remaining=deadline-Date.now();if(remaining<=0)throw Error('ComfyUI generation timed out');try{return await fetch(url,{...options,signal:AbortSignal.timeout(remaining)});}catch(error){if(error.name==='TimeoutError')throw Error('ComfyUI generation timed out');throw Error('ComfyUI is not reachable');}};

export function mapWorkflow(value,placeholders){
  if(Array.isArray(value))return value.map(item=>mapWorkflow(item,placeholders));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,mapWorkflow(item,placeholders)]));
  if(typeof value!=='string')return value;
  const exact=/^\{\{([a-z_]+)\}\}$/.exec(value);if(exact){if(placeholders[exact[1]]==null)throw Error(`Missing required workflow input: ${exact[1]}`);return placeholders[exact[1]];}
  return value.replace(/\{\{([a-z_]+)\}\}/g,(_,key)=>{if(placeholders[key]==null)throw Error(`Missing required workflow input: ${key}`);return String(placeholders[key]);});
}

async function uploadAssets(endpoint,request,directory,deadline){
  const uploaded={};for(const [name,filename] of Object.entries(request.materialized_assets||{})){const file=path.resolve(directory,filename),bytes=await readFile(file),form=new FormData();form.append('image',new Blob([bytes]),path.basename(filename));form.append('overwrite','true');const response=await fetchWithin(endpoint+'/upload/image',{method:'POST',body:form},deadline);if(!response.ok)throw Error('ComfyUI rejected a reference image');const result=await response.json();if(!result?.name)throw Error('ComfyUI returned an invalid upload response');uploaded[name]=result.subfolder?`${result.subfolder}/${result.name}`:result.name;}return uploaded;
}

export async function runBridge(configPath,requestPath){
  let config,request;try{config=JSON.parse(await readFile(configPath,'utf8'));request=JSON.parse(await readFile(requestPath,'utf8'));}catch{throw Error('Invalid bridge configuration or request JSON');}
  const endpoint=localEndpoint(config.endpoint||'http://127.0.0.1:8188'),timeout=config.timeout_ms??55000;if(!Number.isInteger(timeout)||timeout<100||timeout>1800000)throw Error('Bridge timeout must be 100–1800000 ms');const deadline=Date.now()+timeout,directory=path.dirname(requestPath);
  const health=await fetchWithin(endpoint+'/system_stats',{},deadline);if(!health.ok)throw Error('ComfyUI is not reachable');
  const workflowPath=request.operation==='edit_frame'?config.edit_workflow:config.generate_workflow;if(typeof workflowPath!=='string'||!workflowPath)throw Error(`Missing ${request.operation==='edit_frame'?'edit':'generate'} workflow file`);
  let workflow;try{const parsed=JSON.parse(await readFile(path.resolve(path.dirname(configPath),workflowPath),'utf8'));workflow=parsed.prompt||parsed;if(!workflow||typeof workflow!=='object'||Array.isArray(workflow))throw Error();}catch{throw Error('Invalid ComfyUI workflow file');}
  const uploaded=await uploadAssets(endpoint,request,directory,deadline),instruction=[request.instruction,request.animation_type?`Animation: ${request.animation_type}.`:null,Number.isInteger(request.frame_index)?`Frame index: ${request.frame_index}.`:null,request.repair_reasons?.length?`Repair: ${request.repair_reasons.join(', ')}.`:null,'Preserve character identity and direction; match neighboring frames.'].filter(Boolean).join(' '),outputFilename=`sprited-${String(request.animation_id||'animation').replace(/[^a-zA-Z0-9_-]/g,'-')}-${request.frame_index??0}`;
  const prompt=mapWorkflow(workflow,{instruction,prompt:instruction,animation_id:request.animation_id,animation_type:request.animation_type,frame_index:request.frame_index,reference_image:uploaded.reference,current_frame:uploaded.current,previous_frame:uploaded.previous,next_frame:uploaded.next,output_filename:outputFilename}),clientId=randomUUID(),submitted=await fetchWithin(endpoint+'/prompt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt,client_id:clientId})},deadline);if(!submitted.ok)throw Error('ComfyUI rejected the workflow');const queued=await submitted.json();if(!queued?.prompt_id)throw Error('ComfyUI did not return a prompt ID');
  let history;while(Date.now()<deadline){const response=await fetchWithin(`${endpoint}/history/${encodeURIComponent(queued.prompt_id)}`,{},deadline);if(!response.ok)throw Error('ComfyUI execution status failed');const value=await response.json(),entry=value[queued.prompt_id];if(entry?.status?.status_str==='error'||entry?.status?.messages?.some?.(message=>message?.[0]==='execution_error'))throw Error('ComfyUI workflow execution failed');if(entry?.outputs){history=entry;break;}await sleep(100);}if(!history)throw Error('ComfyUI generation timed out');
  const image=Object.values(history.outputs).flatMap(output=>output?.images||[])[0];if(!image?.filename)throw Error('ComfyUI produced no output image');const query=new URLSearchParams({filename:image.filename,subfolder:image.subfolder||'',type:image.type||'output'}),download=await fetchWithin(endpoint+'/view?'+query,{},deadline);if(!download.ok)throw Error('ComfyUI output could not be retrieved');const bytes=Buffer.from(await download.arrayBuffer()),format=imageFormat(bytes,image.filename,download.headers.get('content-type')||'');if(!['png','webp'].includes(format))throw Error('ComfyUI returned an invalid output image');const outputFile=path.join(directory,`comfy-output.${format}`);await writeFile(outputFile,bytes,{flag:'wx'});return {success:true,output_file:path.basename(outputFile),format};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{process.stdout.write(JSON.stringify(await runBridge(process.argv[2],process.argv[3])));}catch(error){process.stdout.write(JSON.stringify({success:false,error:error.message||String(error)}));}}
