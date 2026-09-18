import {readFile} from 'node:fs/promises';

const MAX_VIDEO_BYTES=250*1024*1024;

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const pick=(value,...paths)=>{
  for(const path of paths){let current=value;for(const key of path.split('.'))current=current?.[key];if(typeof current==='string'&&current)return current;}
  return null;
};

/** A provider never exposes credentials to a caller. It returns a completed remote video URL or a test fixture path. */
export class HttpVideoProvider {
  constructor({apiUrl,apiKey,provider='http',pollIntervalMs=3000,maxPollAttempts=80,statusUrlTemplate=null}={}){
    this.apiUrl=apiUrl;this.apiKey=apiKey;this.provider=provider;this.pollIntervalMs=pollIntervalMs;this.maxPollAttempts=maxPollAttempts;this.statusUrlTemplate=statusUrlTemplate;
  }
  get available(){return Boolean(this.apiUrl&&this.apiKey);}
  headers(){return {'content-type':'application/json',authorization:`Bearer ${this.apiKey}`};}
  async request(url,options){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);try{const response=await fetch(url,{...options,signal:controller.signal});if(!response.ok)throw Error(`Video Generator API request failed (${response.status})`);return response.json();}finally{clearTimeout(timer);}}
  async generateAnimation({prompt,referenceImage,frames,animationType}){
    if(!this.available)throw Error('Video Generator API is not configured');
    const payload={prompt,frames,animation_type:animationType,reference_image:referenceImage?{data:referenceImage.bytes.toString('base64'),mime_type:referenceImage.mime_type}:undefined};
    let result=await this.request(this.apiUrl,{method:'POST',headers:this.headers(),body:JSON.stringify(payload)});
    let videoUrl=pick(result,'video_url','video.url','output.video_url','data.video_url');
    const jobId=pick(result,'id','job_id','task_id','data.id');
    const statusUrl=pick(result,'status_url','urls.status')||(jobId?(this.statusUrlTemplate?this.statusUrlTemplate.replace('{id}',encodeURIComponent(jobId)):`${this.apiUrl.replace(/\/$/,'')}/${encodeURIComponent(jobId)}`):null);
    for(let attempt=0;!videoUrl&&statusUrl&&attempt<this.maxPollAttempts;attempt+=1){await sleep(this.pollIntervalMs);result=await this.request(statusUrl,{headers:this.headers()});const state=String(pick(result,'status','data.status')||'').toLowerCase();if(['failed','cancelled','canceled','error'].includes(state))throw Error('Video Generator reported a failed job');videoUrl=pick(result,'video_url','video.url','output.video_url','data.video_url');}
    if(!videoUrl)throw Error('Video Generator did not return a completed video URL before the timeout');
    return {provider:this.provider,job_id:jobId||null,video_url:videoUrl,raw_status:'completed'};
  }
}

/** Test-only adapter. It is deliberately not a local generation engine. */
export class MockVideoProvider {
  constructor({fixturePath=process.env.SPRITED_MOCK_VIDEO_PATH||null}={}){this.fixturePath=fixturePath;this.provider='mock';}
  get available(){return true;}
  async generateAnimation({prompt,frames}){
    if(!this.fixturePath)throw Error('Mock provider needs SPRITED_MOCK_VIDEO_PATH pointing to a test video');
    return {provider:'mock',job_id:`mock-${Date.now()}`,video_path:this.fixturePath,prompt,frames,raw_status:'completed'};
  }
}

export function createVideoProvider(env=process.env){
  const provider=String(env.SPRITED_VIDEO_PROVIDER||'mock').toLowerCase();
  if(provider==='mock')return new MockVideoProvider({fixturePath:env.SPRITED_MOCK_VIDEO_PATH});
  return new HttpVideoProvider({apiUrl:env.SPRITED_VIDEO_API_URL,apiKey:env.SPRITED_VIDEO_API_KEY,provider,pollIntervalMs:Number(env.SPRITED_VIDEO_POLL_INTERVAL_MS)||3000,maxPollAttempts:Number(env.SPRITED_VIDEO_MAX_POLL_ATTEMPTS)||80,statusUrlTemplate:env.SPRITED_VIDEO_STATUS_URL_TEMPLATE||null});
}

/** Loads only SPRITED_VIDEO_* values and never overwrites explicit process environment values. */
export async function loadVideoEnvironment(file,env=process.env){
  let text;try{text=await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return;throw error;}
  for(const raw of text.split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith('#'))continue;const match=/^([A-Z0-9_]+)=(.*)$/.exec(line);if(!match||!match[1].startsWith('SPRITED_VIDEO_')||env[match[1]]!=null)continue;let value=match[2].trim();if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);env[match[1]]=value;}
}

export async function downloadGeneratedVideo(result){
  if(result.video_path)return {bytes:null,sourcePath:result.video_path,extension:result.video_path.match(/\.(mp4|webm|mov)$/i)?.[0]?.toLowerCase()||'.mp4'};
  const url=new URL(result.video_url);if(url.protocol!=='https:')throw Error('Generated video download must use HTTPS');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);
  try{const response=await fetch(url,{redirect:'follow',signal:controller.signal});if(!response.ok)throw Error(`Generated video download failed (${response.status})`);const declared=Number(response.headers.get('content-length')||0);if(declared>MAX_VIDEO_BYTES)throw Error('Generated video exceeds 250 MB');const bytes=Buffer.from(await response.arrayBuffer());if(!bytes.length||bytes.length>MAX_VIDEO_BYTES)throw Error('Generated video must be between 1 byte and 250 MB');const contentType=response.headers.get('content-type')||'';const extension=/webm/.test(contentType)||/\.webm(?:\?|$)/i.test(url.pathname)?'.webm':/quicktime/.test(contentType)||/\.mov(?:\?|$)/i.test(url.pathname)?'.mov':'.mp4';return {bytes,sourcePath:null,extension};}catch(error){if(error?.name==='AbortError')throw Error('Generated video download timed out');throw error;}finally{clearTimeout(timer);}
}
