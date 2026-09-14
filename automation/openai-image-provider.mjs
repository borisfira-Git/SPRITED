import {ImageProvider,normalizeFrameBytes} from './image-provider.mjs';

const DEFAULT_MODEL='gpt-image-2.5-sunburst';
const QUALITIES=new Set(['auto','low','medium','high','xhigh','max']);
const ENV_NAME=/^[A-Z_][A-Z0-9_]{0,127}$/;
const clean=(value,secret='')=>{let result=String(value||'').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]');if(secret)result=result.split(secret).join('[redacted]');return result.slice(0,500);};

const validateSize=value=>{
  const match=/^(\d{2,4})x(\d{2,4})$/.exec(String(value||''));
  if(!match)throw Error('OpenAI image size must be WIDTHxHEIGHT');
  const width=Number(match[1]),height=Number(match[2]),pixels=width*height,ratio=width/height;
  if(width%16||height%16||width>3840||height>3840||pixels<655360||pixels>8294400||ratio<1/3||ratio>3)throw Error('OpenAI image size is outside the supported range');
  return `${width}x${height}`;
};

const promptFor=(operation,context,labels)=>{
  const total=Number.isInteger(context.total_frame_count)?context.total_frame_count:'the requested';
  const size=Array.isArray(context.required_output_size)?context.required_output_size.join('x'):'the project canvas';
  const reasons=[...(context.repair_reasons||[]),...(context.repair_issue_descriptions||[])].filter(Boolean).join('; ');
  const parts=[operation==='edit_frame'?`Repair only frame ${context.frame_index+1} of ${total}.`:`Create frame ${context.frame_index+1} of ${total}.`,`Animation: ${context.animation_type||'unspecified'}.`,context.instruction||'Create the requested animation pose.',`Required final canvas: ${size}.`,`Background: ${context.background_requirement||'preserve the project requirement'}.`,context.direction?`Direction: ${context.direction}.`:null,operation==='edit_frame'&&reasons?`Repair issues: ${reasons}.`:null,'Preserve the exact character identity, face, hair, armor/clothing, colors, equipment, direction, scale, framing, and visual style.','Return exactly one complete frame.',labels.length?`Input image order: ${labels.join(', ')}.`:null];
  return parts.filter(Boolean).join(' ');
};

export class OpenAIImageProvider extends ImageProvider {
  constructor(config={},options={}){
    super('openai_api');
    if('api_key' in config)throw Error('OpenAI API keys must be provided through an environment variable');
    this.config={enabled:config.enabled===true,api_key_env:config.api_key_env||'OPENAI_API_KEY',model:config.model||DEFAULT_MODEL,size:config.default_size||'1024x1024',quality:config.default_quality||'medium',timeout_ms:config.timeout_ms??120000};
    if(!ENV_NAME.test(this.config.api_key_env))throw Error('Invalid OpenAI API key environment variable name');
    if(typeof this.config.model!=='string'||!/^gpt-image-[A-Za-z0-9._-]+$/.test(this.config.model)||this.config.model.length>120)throw Error('Invalid OpenAI image model');
    this.config.size=validateSize(this.config.size);
    if(!QUALITIES.has(this.config.quality))throw Error('Invalid OpenAI image quality');
    if(!Number.isInteger(this.config.timeout_ms)||this.config.timeout_ms<1000||this.config.timeout_ms>300000)throw Error('OpenAI request timeout must be 1000–300000 ms');
    this.assetResolver=options.assetResolver;this.fetchImpl=options.fetchImpl||globalThis.fetch;this.environment=options.environment||process.env;this.baseUrl=options.baseUrl||'https://api.openai.com/v1';
  }
  status(){const key=String(this.environment[this.config.api_key_env]||'');return {id:this.id,available:this.config.enabled&&Boolean(key),generates:true,health:!this.config.enabled?'disabled':key?'ready':'missing_api_key',model:this.config.model};}
  apiKey(){if(!this.config.enabled)throw Error('OpenAI API provider is not enabled');const key=String(this.environment[this.config.api_key_env]||'');if(!key)throw Error(`OpenAI API key is not configured in ${this.config.api_key_env}`);return key;}
  async resolveAssets(operation,context){
    if(typeof this.assetResolver!=='function')throw Error('OpenAI image provider asset resolver is unavailable');
    const order=operation==='edit_frame'?['current','reference','previous','next']:['reference','previous','next'],items=[];
    for(const name of order){const reference=context.assets?.[name];if(!reference)continue;const asset=await this.assetResolver(reference);if(!asset?.bytes||!['image/png','image/webp'].includes(asset.mime_type))throw Error(`OpenAI ${name} image is unavailable`);items.push({name,...asset});}
    if(!items.some(item=>item.name==='reference'))throw Error('OpenAI frame generation requires a character reference image');
    if(operation==='edit_frame'&&!items.some(item=>item.name==='current'))throw Error('OpenAI frame repair requires the current frame');
    return items;
  }
  async request(operation,context){
    const key=this.apiKey(),assets=await this.resolveAssets(operation,context),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.config.timeout_ms);
    try{
      const form=new FormData();form.set('model',this.config.model);form.set('prompt',promptFor(operation,context,assets.map(item=>item.name)));form.set('size',this.config.size);form.set('quality',this.config.quality);form.set('output_format','png');form.set('n','1');
      for(const asset of assets)form.append('image[]',new Blob([asset.bytes],{type:asset.mime_type}),`${asset.name}.${asset.mime_type==='image/webp'?'webp':'png'}`);
      let response;try{response=await this.fetchImpl(`${this.baseUrl}/images/edits`,{method:'POST',headers:{authorization:`Bearer ${key}`},body:form,signal:controller.signal});}catch(error){if(error?.name==='AbortError')throw Error('OpenAI image request timed out');throw Error('OpenAI image request could not be completed');}
      let payload;try{payload=await response.json();}catch{throw Error('OpenAI image API returned an invalid response');}
      if(!response.ok)throw Error(`OpenAI image API error: ${clean(payload?.error?.message||response.statusText||`HTTP ${response.status}`,key)}`);
      const encoded=payload?.data?.[0]?.b64_json;if(typeof encoded!=='string'||!encoded.length)throw Error('OpenAI image API did not return an image');
      const normalized=normalizeFrameBytes(Buffer.from(encoded,'base64'),'png',this.id);
      const requestId=typeof response.headers?.get==='function'?clean(response.headers.get('x-request-id')||'').replace(/[^A-Za-z0-9._:-]/g,'').slice(0,120)||null:null;
      return {...normalized,provider_metadata:{operation,model:this.config.model,size:this.config.size,quality:this.config.quality,request_id:requestId}};
    } finally {clearTimeout(timer);}
  }
  async generate_frame(context){return this.request('generate_frame',context);}
  async edit_frame(context){return this.request('edit_frame',context);}
}
