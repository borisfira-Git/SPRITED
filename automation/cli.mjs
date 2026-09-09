#!/usr/bin/env node
import {Service,failure} from './service.mjs';
import {serve} from './http.mjs';
import {startMcp} from './mcp.mjs';
const argv=process.argv.slice(2),options={},words=[];
for(let i=0;i<argv.length;i++){
  if(argv[i]==='--json')options.json=true;
  else if(argv[i].startsWith('--')){const key=argv[i].slice(2).replaceAll('-','_');if(!argv[i+1]||argv[i+1].startsWith('--')){console.error(JSON.stringify(failure(new Error(`Missing ${argv[i]} value`))));process.exit(1);}options[key]=argv[++i];}
  else words.push(argv[i]);
}
if(words[0]==='help'||!words.length){
  console.log('SPRITED automation\nnode automation/cli.mjs <command> --workspace <folder> [--json]\nCommands: status, project open <path>, video import <file>, video extract --start 0 --end 2 --frames 25, frames get|align|normalize|remove-background, animation validate|preview, spritesheet build --cols 5, export godot [folder], serve, mcp\nUse --mode right_foot or body; --color #00ff00; --max-size 512. Outputs stay inside the configured workspace.');
  process.exit(0);
}
let service;
try {
  service=new Service(options.workspace||process.cwd());await service.init();
  const shutdown=async()=>{await service.close();process.exit(0);};process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
  if(words[0]==='mcp')startMcp(service);
  else if(words[0]==='serve'){
    const port=Number(options.port||47821);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');
    const running=await serve(service,port);
    console.log(`SPRITED API: http://127.0.0.1:${running.port}\nBearer token: ${running.token}`);
  } else {
    const action=words[0]==='status'?'status':`${words[0]}/${words[1]}`,args={};
    for(const [key,value] of Object.entries(options))if(!['workspace','json','port'].includes(key))args[key]=['start','end','frames','cols','max_size','tolerance','softness'].includes(key)?Number(value):value;
    if(words[2])args[action==='export/godot'?'folder':'path']=words[2];
    const result=await service.call(action,args);
    console.log(options.json?JSON.stringify(result):JSON.stringify(result,null,2));await service.close();process.exitCode=result.success?0:1;
  }
}catch(error){console[words[0]==='mcp'?'error':'log'](JSON.stringify(failure(error)));await service?.close();process.exitCode=1;}
