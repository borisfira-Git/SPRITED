import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile,realpath,stat,rm} from 'node:fs/promises';
import path from 'node:path';

const normalizeBytes=(bytes,format,provider)=>{
  if(!['png','webp'].includes(format))throw Error('Frame format must be png or webp');
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>9*1024*1024)throw Error('Frame image is missing or too large');
  const png=bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),webp=bytes.length>=12&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if((format==='png'&&!png)||(format==='webp'&&!webp))throw Error(`Submitted bytes are not a valid ${format.toUpperCase()} image`);
  return {bytes,format,mime_type:`image/${format}`,provider};
};

export class ImageProvider {
  constructor(id){this.id=id;}
  async generate_frame(){throw Error('Image provider must implement generate_frame');}
  async edit_frame(){throw Error('Image provider must implement edit_frame');}
}

export class ExternalManualProvider extends ImageProvider {
  constructor(){super('external_manual');}
  normalize({image_base64,format}){if(typeof image_base64!=='string'||!image_base64.length||image_base64.length>12*1024*1024)throw Error('Frame image is missing or too large');return normalizeBytes(Buffer.from(image_base64,'base64'),format,this.id);}
  async generate_frame(request){return this.normalize(request);}
  async edit_frame(request){return this.normalize(request);}
}

export class LocalProcessProvider extends ImageProvider {
  constructor(config={},options={}){super('local_process');this.config=config;this.tempRoot=options.tempRoot;this.assetResolver=options.assetResolver;}
  async run(operation,context){
    if(!this.config.enabled)throw Error('Local process provider is not configured or enabled');
    if(typeof this.config.executable!=='string'||!this.config.executable)throw Error('Local process executable is not configured');
    if(!Array.isArray(this.config.arguments||[])||(this.config.arguments||[]).some(value=>typeof value!=='string'||value.length>4096))throw Error('Invalid local process arguments');
    const timeout=this.config.timeout_ms??15000;if(!Number.isInteger(timeout)||timeout<100||timeout>60000)throw Error('Local process timeout must be 100–60000 ms');
    let executable;try{executable=await realpath(this.config.executable);const info=await stat(executable);if(!info.isFile())throw Error();}catch{throw Error('Local process executable was not found');}
    let script=null;if(this.config.script!==undefined){if(typeof this.config.script!=='string'||!this.config.script)throw Error('Invalid local process script');try{script=await realpath(this.config.script);const info=await stat(script);if(!info.isFile())throw Error();}catch{throw Error('Local process script was not found');}}
    if(!this.tempRoot||!this.assetResolver)throw Error('Local process provider runtime is unavailable');await mkdir(this.tempRoot,{recursive:true});const directory=await mkdtemp(path.join(this.tempRoot,'request-'));
    try{
      const materialized={};for(const [name,reference] of Object.entries(context.assets||{})){if(!reference)continue;const asset=await this.assetResolver(reference),format=asset.mime_type==='image/webp'?'webp':'png',filename=`${name}.${format}`;await writeFile(path.join(directory,filename),asset.bytes,{flag:'wx'});materialized[name]=filename;}
      const request={operation,animation_id:context.animation_id,frame_index:context.frame_index,animation_type:context.animation_type,reference_asset:context.reference_asset||null,previous_frame:context.previous_frame||null,next_frame:context.next_frame||null,current_frame:context.current_frame||null,repair_reasons:context.repair_reasons||[],instruction:context.instruction||null,materialized_assets:materialized},requestFile=path.join(directory,'request.json');await writeFile(requestFile,JSON.stringify(request,null,2),{flag:'wx'});
      const response=await new Promise((resolve,reject)=>{const child=spawn(executable,[...(script?[script]:[]),...(this.config.arguments||[]),requestFile],{cwd:directory,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']}),chunks=[];let size=0,settled=false;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};child.stdout.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){child.kill();finish(Error('Local process response is too large'));}else chunks.push(chunk);});child.on('error',()=>finish(Error('Local process could not be started')));child.on('exit',code=>code===0?finish(null,Buffer.concat(chunks).toString('utf8')):finish(Error(`Local process failed with exit code ${code}`)));const timer=setTimeout(()=>{child.kill();finish(Error('Local process timed out'));},timeout);});
      let parsed;try{parsed=JSON.parse(response.trim());}catch{throw Error('Local process returned invalid JSON');}if(!parsed?.success)throw Error(typeof parsed?.error==='string'?`Local process failed: ${parsed.error}`:'Local process reported failure');if(typeof parsed.output_file!=='string'||!parsed.output_file)throw Error('Local process did not return an output file');
      const output=await realpath(path.resolve(directory,parsed.output_file)).catch(()=>null),relative=output?path.relative(directory,output):null;if(!output||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Local process output file is missing or outside its request directory');const info=await stat(output);if(!info.isFile()||info.size>9*1024*1024)throw Error('Local process output is missing or too large');const format=String(parsed.format||path.extname(output).slice(1)).toLowerCase();return {...normalizeBytes(await readFile(output),format,this.id),provider_metadata:{operation}};
    } finally {await rm(directory,{recursive:true,force:true}).catch(()=>{});}
  }
  async generate_frame(context){return this.run('generate_frame',context);}
  async edit_frame(context){return this.run('edit_frame',context);}
}
