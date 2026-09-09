import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readdir} from 'node:fs/promises';
import path from 'node:path';
const exec=promisify(execFile);
async function probe(command,args){try {const r=await exec(command,args,{timeout:4000,windowsHide:true,maxBuffer:8192});return {available:true,detail:(r.stdout||r.stderr).trim().slice(0,1000)};}catch{return {available:false,detail:'Not found or not accessible'};}}
export async function diagnostics(root){
  const [ffmpeg,python,nvidia]=await Promise.all([probe('ffmpeg',['-version']),probe('python',['--version']),probe('nvidia-smi',['--query-gpu=name,memory.total','--format=csv,noheader'])]);
  let comfy={available:false,url:'http://127.0.0.1:8188',detail:'Not reachable'};
  try {const response=await fetch(comfy.url+'/system_stats',{signal:AbortSignal.timeout(2500),redirect:'error'});comfy.available=response.ok;comfy.detail=response.ok?'Server responds; workflows and models still require verification':'Server error';}catch{}
  let modelFiles=[];try{modelFiles=await readdir(path.join(root,'models'));}catch{}
  return {cpu:os.cpus()[0]?.model||'unknown',ram_bytes:os.totalmem(),gpu:nvidia.available?nvidia.detail:'No NVIDIA GPU detected; other GPU/VRAM unknown to this probe',ffmpeg,python,comfyui:comfy,models:{directory:'models',entries:modelFiles,downloads_enabled:false},pipeline:'ready',agent_connection:'unknown',local_generator:'not_configured',manual_provider:'ready'};
}
