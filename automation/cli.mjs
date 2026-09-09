#!/usr/bin/env node
import {Service,failure} from './service.mjs';
import {serve} from './http.mjs';
import {startMcp} from './mcp.mjs';
const argv=process.argv.slice(2),options={},words=[];
for(let i=0;i<argv.length;i++){
  if(argv[i]==='--json')options.json=true;
  else if(argv[i]==='--loop'){options.loop=argv[i+1]==='false'?(i++,false):argv[i+1]==='true'?(i++,true):true;}
  else if(argv[i].startsWith('--')){const key=argv[i].slice(2).replaceAll('-','_');if(!argv[i+1]||argv[i+1].startsWith('--')){console.error(JSON.stringify(failure(new Error(`Missing ${argv[i]} value`))));process.exit(1);}options[key]=argv[++i];}
  else words.push(argv[i]);
}
if(words[0]==='help'||!words.length){
  console.log('SPRITED automation\nnode automation/cli.mjs <command> --workspace <folder> [--json]\nCommands: status, project open <path>, video import <file>, video extract --start 0 --end 2 --frames 25, frames get|align|normalize|remove-background, animation validate|preview, spritesheet build --cols 5, export godot [folder], serve, mcp\nUse --mode right_foot or body; --color #00ff00; --max-size 512. Outputs stay inside the configured workspace.');
  process.exit(0);
}
let service;
try {
  if(options.api){
    const base=new URL(options.api);if(base.protocol!=='http:'||!['127.0.0.1','localhost'].includes(base.hostname)||base.username||base.password)throw Error('API must be a loopback HTTP address');
    const token=options.token||process.env.SPRITED_TOKEN;if(!token)throw Error('Set SPRITED_TOKEN for the running API');
    service={close:async()=>{},call:async(action,args={})=>{const reads=['connections/status','connections/setup','status','frames/get','character/show','character/list','character/trash','recipes/list','providers/list','router/status','diagnostics/status','animation/list','animation/status','jobs/list','jobs/get','attempts/list'];let endpoint=action;
      if(action==='animation/status')endpoint='generation-runs/'+encodeURIComponent(args.id);
      if(action==='jobs/get')endpoint='generation-jobs/'+encodeURIComponent(args.id);
      const method=reads.includes(action)?'GET':'POST',url=new URL('/'+endpoint,base);if(method==='GET')for(const [key,value] of Object.entries(args))if(key!=='id')url.searchParams.set(key,String(value));const response=await fetch(url,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(args)}:{})});return response.json();}};
  }else{service=new Service(options.workspace||process.cwd());await service.init();}
  const shutdown=async()=>{await service.close();process.exit(0);};process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
  if(words[0]==='mcp')startMcp(service);
  else if(words[0]==='serve'){
    const port=Number(options.port||47821);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');
    const running=await serve(service,port);
    console.log(`SPRITED API: http://127.0.0.1:${running.port}\nLibrary: http://127.0.0.1:${running.port}/ui/#${running.token}\nBearer token: ${running.token}`);
  } else {
    const action=words[0]==='status'?'status':`${words[0]}/${words[1]}`,args={};
    for(const [key,value] of Object.entries(options))if(!['workspace','json','port','canvas','api','token'].includes(key))args[key]=['duration','start','end','frames','cols','max_size','tolerance','softness','source_frames','output_frames','canvas_width','canvas_height'].includes(key)?Number(value):value;
    if(options.canvas){const match=options.canvas.match(/^(\d+)x(\d+)$/);if(!match)throw Error('Use --canvas 256x256');args.canvas_width=Number(match[1]);args.canvas_height=Number(match[2]);}
    if(words[2]){
      if(action==='animation/create')args.animation_type=words[2];
      else if((action.startsWith('animation/')&&!['animation/validate','animation/preview'].includes(action))||action.startsWith('jobs/')||action.startsWith('attempts/')||action==='spritesheet/create'||['character/select','character/delete','character/restore','character/purge'].includes(action)){args.id=words[2];if(words[3])args.path=words[3];}
      else args[action==='export/godot'?'folder':'path']=words[2];
    }
    const result=await service.call(action,args);
    console.log(options.json?JSON.stringify(result):JSON.stringify(result,null,2));await service.close();process.exitCode=result.success?0:1;
  }
}catch(error){console[words[0]==='mcp'?'error':'log'](JSON.stringify(failure(error)));await service?.close();process.exitCode=1;}
