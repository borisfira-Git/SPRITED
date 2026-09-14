import {ImageProvider,normalizeFrameBytes} from './image-provider.mjs';

const DEFAULT_MODEL='gemini-3.1-flash-image';
const RESOLUTIONS=new Set(['0.5K','1K','2K','4K']);
const ENV_NAME=/^[A-Z_][A-Z0-9_]{0,127}$/;
const clean=(value,secret='')=>{let result=String(value||'').replace(/AIza[A-Za-z0-9_-]+/g,'[redacted]');if(secret)result=result.split(secret).join('[redacted]');return result.slice(0,500);};

const promptFor=(operation,context,labels)=>{
  const total=Number.isInteger(context.total_frame_count)?context.total_frame_count:'the requested';
  const size=Array.isArray(context.required_output_size)?context.required_output_size.join('x'):'the project canvas';
  const reasons=[...(context.repair_reasons||[]),...(context.repair_issue_descriptions||[])].filter(Boolean).join('; ');
  return [operation==='edit_frame'?`Repair only frame ${context.frame_index+1} of ${total}.`:`Create frame ${context.frame_index+1} of ${total}.`,`Animation: ${context.animation_type||'unspecified'}.`,context.instruction||'Create the requested animation pose.',`Required final canvas: ${size}.`,`Background: ${context.background_requirement||'preserve the project requirement'}.`,context.direction?`Direction: ${context.direction}.`:null,operation==='edit_frame'&&reasons?`Repair issues: ${reasons}.`:null,'Preserve the exact character identity, face, hair, armor/clothing, colors, equipment, direction, scale, framing, and visual style.','Return exactly one complete frame.',labels.length?`Input image order: ${labels.join(', ')}.`:null].filter(Boolean).join(' ');
};

export class GeminiImageProvider extends ImageProvider {
  constructor(config={},options={}){
    super('gemini_api');
    if('api_key' in config)throw Error('Gemini API keys must be provided through an environment variable');
    this.config={enabled:config.enabled===true,api_key_env:config.api_key_env||'GEMINI_API_KEY',model:config.model||DEFAULT_MODEL,resolution:config.default_resolution||'1K',timeout_ms:config.timeout_ms??120000};
    if(!ENV_NAME.test(this.config.api_key_env))throw Error('Invalid Gemini API key environment variable name');
    if(typeof this.config.model!=='string'||!/^gemini-[A-Za-z0-9._-]+-image$/.test(this.config.model)||this.config.model.length>120)throw Error('Invalid Gemini image model');
    if(!RESOLUTIONS.has(this.config.resolution))throw Error('Gemini image resolution must be 0.5K, 1K, 2K, or 4K');
    if(!Number.isInteger(this.config.timeout_ms)||this.config.timeout_ms<1000||this.config.timeout_ms>300000)throw Error('Gemini request timeout must be 1000–300000 ms');
    this.assetResolver=options.assetResolver;this.fetchImpl=options.fetchImpl||globalThis.fetch;this.environment=options.environment||process.env;this.baseUrl=options.baseUrl||'https://generativelanguage.googleapis.com/v1beta';
  }
  status(){const key=String(this.environment[this.config.api_key_env]||'');return {id:this.id,available:this.config.enabled&&Boolean(key),generates:true,health:!this.config.enabled?'disabled':key?'ready':'missing_api_key',model:this.config.model,free_tier_available:false};}
  apiKey(){if(!this.config.enabled)throw Error('Gemini API provider is not enabled');const key=String(this.environment[this.config.api_key_env]||'');if(!key)throw Error(`Gemini API key is not configured in ${this.config.api_key_env}`);return key;}
  async resolveAssets(operation,context){
    if(typeof this.assetResolver!=='function')throw Error('Gemini image provider asset resolver is unavailable');
    const order=operation==='edit_frame'?['current','reference','previous','next']:['reference','previous','next'],items=[];
    for(const name of order){const reference=context.assets?.[name];if(!reference)continue;const asset=await this.assetResolver(reference);if(!asset?.bytes||!['image/png','image/webp'].includes(asset.mime_type))throw Error(`Gemini ${name} image is unavailable`);items.push({name,...asset});}
    if(!items.some(item=>item.name==='reference'))throw Error('Gemini frame generation requires a character reference image');
    if(operation==='edit_frame'&&!items.some(item=>item.name==='current'))throw Error('Gemini frame repair requires the current frame');
    return items;
  }
  async request(operation,context){
    const key=this.apiKey(),assets=await this.resolveAssets(operation,context),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.config.timeout_ms);
    const input=[...assets.map(asset=>({type:'image',mime_type:asset.mime_type,data:asset.bytes.toString('base64')})),{type:'text',text:promptFor(operation,context,assets.map(item=>item.name))}];
    const body={model:this.config.model,input,response_format:{type:'image',mime_type:'image/png',aspect_ratio:'1:1',image_size:this.config.resolution}};
    try{
      let response;try{response=await this.fetchImpl(`${this.baseUrl}/interactions`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},body:JSON.stringify(body),signal:controller.signal});}catch(error){if(error?.name==='AbortError')throw Error('Gemini image request timed out');throw Error('Gemini image request could not be completed');}
      let payload;try{payload=await response.json();}catch{throw Error('Gemini image API returned an invalid response');}
      if(!response.ok)throw Error(`Gemini image API error: ${clean(payload?.error?.message||response.statusText||`HTTP ${response.status}`,key)}`);
      const images=(payload?.steps||[]).filter(step=>step?.type==='model_output').flatMap(step=>step.content||[]).filter(content=>content?.type==='image'&&typeof content.data==='string');
      if(!images.length)throw Error('Gemini image API did not return an image');
      const image=images.at(-1),format=image.mime_type==='image/webp'?'webp':'png',normalized=normalizeFrameBytes(Buffer.from(image.data,'base64'),format,this.id),interactionId=clean(payload.id||'').replace(/[^A-Za-z0-9._:-]/g,'').slice(0,120)||null;
      return {...normalized,provider_metadata:{operation,model:this.config.model,resolution:this.config.resolution,free_tier_available:false,interaction_id:interactionId}};
    } finally {clearTimeout(timer);}
  }
  async generate_frame(context){return this.request('generate_frame',context);}
  async edit_frame(context){return this.request('edit_frame',context);}
}
