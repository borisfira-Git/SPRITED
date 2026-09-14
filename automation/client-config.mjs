import {copyFile,readFile,rename,unlink,writeFile} from 'node:fs/promises';
import path from 'node:path';

const clients={
  cline:home=>path.join(home,'.cline','data','settings','cline_mcp_settings.json'),
  codex:home=>path.join(home,'.codex','config.toml')
};
const tomlString=value=>JSON.stringify(String(value));
function bracketDelta(text){let quote=null,delta=0;for(let i=0;i<text.length;i++){const char=text[i];if(quote){if(char==='\\'&&quote==='"'){i++;continue;}if(char===quote)quote=null;continue;}if(char==='#')break;if(char==='"'||char==="'"){quote=char;continue;}if(char==='['||char==='{')delta++;if(char===']'||char==='}')delta--;}return delta;}

function validateTomlShape(text){
  if(text.includes('\0'))throw Error('Codex config contains invalid data');
  let quote=null,depth=0;
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim();if(!line||line.startsWith('#'))continue;
    if(!quote&&depth===0&&line.startsWith('[')){if(!/^\[\[?.+\]\]?\s*(?:#.*)?$/.test(line))throw Error('Codex config contains an invalid section header');continue;}
    const continuation=Boolean(quote)||depth>0;let hasEquals=false,comment=false;
    for(let i=0;i<raw.length;i++){
      const char=raw[i];if(comment)break;
      if(quote){if(char==='\\'&&quote==='"'){i++;continue;}if(char===quote)quote=null;continue;}
      if(char==='#'){comment=true;continue;}if(char==='"'||char==="'"){quote=char;continue;}if(char==='=')hasEquals=true;if(char==='['||char==='{')depth++;if(char===']'||char==='}')depth--;
      if(depth<0)throw Error('Codex config contains unbalanced values');
    }
    if(depth===0&&!quote&&!hasEquals&&!continuation)throw Error('Codex config contains an invalid assignment');
  }
  if(quote||depth!==0)throw Error('Codex config contains an incomplete value');
}

function updateCline(text,{command,cliPath,apiUrl,token},enabled=true){
  let value;try{value=JSON.parse(text);}catch{throw Error('Cline MCP config is invalid JSON');}
  if(!value||Array.isArray(value)||typeof value!=='object')throw Error('Cline MCP config must contain a JSON object');
  if(value.mcpServers!=null&&(Array.isArray(value.mcpServers)||typeof value.mcpServers!=='object'))throw Error('Cline mcpServers must be an object');
  const servers=value.mcpServers||{},current=servers.sprited&&typeof servers.sprited==='object'&&!Array.isArray(servers.sprited)?servers.sprited:{};
  value.mcpServers={...servers,sprited:{...current,command,args:[cliPath,'mcp','--api',apiUrl],env:{...(current.env&&typeof current.env==='object'?current.env:{}),SPRITED_TOKEN:token,SPRITED_CLIENT:'cline'},disabled:!enabled}};
  const output=JSON.stringify(value,null,2)+'\n';JSON.parse(output);return output;
}

function updateCodex(text,{command,cliPath,apiUrl,token},enabled=true){
  validateTomlShape(text);const newline=text.includes('\r\n')?'\r\n':'\n',lines=text.match(/[^\r\n]*(?:\r\n|\n|$)/g).filter(Boolean),targets=new Set(['mcp_servers.sprited','mcp_servers.sprited.env']),kept=[],extra={main:[],env:[]};let target=null,skipManagedDepth=0;
  for(const full of lines){const plain=full.replace(/\r?\n$/,''),match=plain.trim().match(/^\[([^\]]+)\]\s*(?:#.*)?$/);if(match){target=targets.has(match[1])?match[1]:null;skipManagedDepth=0;}if(target){if(!match){if(skipManagedDepth>0){skipManagedDepth+=bracketDelta(plain);continue;}const assignment=plain.trim().match(/^([A-Za-z0-9_-]+)\s*=(.*)$/),key=assignment?.[1],managed=target.endsWith('.env')?['SPRITED_TOKEN','SPRITED_CLIENT'].includes(key):['command','args','enabled'].includes(key);if(managed){skipManagedDepth=Math.max(0,bracketDelta(assignment[2]));continue;}if(plain.trim())extra[target.endsWith('.env')?'env':'main'].push(plain);}continue;}kept.push(full);}
  let base=kept.join('').replace(/[\r\n]*$/,'');const args=[cliPath,'mcp','--api',apiUrl].map(tomlString).join(', '),main=[`[mcp_servers.sprited]`,`command = ${tomlString(command)}`,`args = [${args}]`,`enabled = ${enabled}`,...extra.main],env=[`[mcp_servers.sprited.env]`,`SPRITED_TOKEN = ${tomlString(token)}`,`SPRITED_CLIENT = "codex"`,...extra.env];base+=(base?newline+newline:'')+main.join(newline)+newline+newline+env.join(newline)+newline;validateTomlShape(base);return base;
}

function disableCline(text){let value;try{value=JSON.parse(text);}catch{throw Error('Cline MCP config is invalid JSON');}const entry=value?.mcpServers?.sprited;if(!entry||typeof entry!=='object'||Array.isArray(entry))return null;value.mcpServers.sprited={...entry,disabled:true};return JSON.stringify(value,null,2)+'\n';}
function disableCodex(text){validateTomlShape(text);if(!/^\s*\[mcp_servers\.sprited\]\s*(?:#.*)?$/m.test(text))return null;const newline=text.includes('\r\n')?'\r\n':'\n',lines=text.split(/\r?\n/),out=[];let inMain=false,found=false;for(const line of lines){const section=line.trim().match(/^\[([^\]]+)\]\s*(?:#.*)?$/);if(section)inMain=section[1]==='mcp_servers.sprited';if(inMain&&/^\s*enabled\s*=/.test(line)){if(!found)out.push('enabled = false');found=true;continue;}if(inMain&&section&&section[1]!=='mcp_servers.sprited')inMain=false;if(inMain&&!found&&line.trim()==='' ){out.push('enabled = false');found=true;}out.push(line);}if(!found){const index=out.findIndex(line=>/^\s*\[mcp_servers\.sprited\.(?:env|.+)\]\s*(?:#.*)?$/.test(line));out.splice(index<0?out.length:index,0,'enabled = false');}const result=out.join(newline);validateTomlShape(result);return result;}

async function backedUpWrite(file,contents){
  const backup=file+'.sprited-backup',temporary=file+'.sprited-tmp';await copyFile(file,backup);try{await writeFile(temporary,contents,{flag:'w'});await rename(temporary,file);}catch(error){await unlink(temporary).catch(()=>{});throw error;}return backup;
}

export function clientConfigPath(client,home){if(!clients[client])throw Error('Unsupported MCP client');return clients[client](home);}
export async function configureMcpClient({client,home,command,cliPath,apiUrl,token}){
  if(!clients[client])throw Error('Choose Cline or Codex');const file=clients[client](home),inactive=client==='cline'?'codex':'cline',inactiveFile=clients[inactive](home);let original;try{original=await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')throw Error(`${client==='cline'?'Cline':'Codex'} config was not found`);throw error;}
  const settings={command,cliPath,apiUrl,token},output=client==='cline'?updateCline(original,settings,true):updateCodex(original,settings,true);let inactiveOriginal=null,inactiveOutput=null;try{inactiveOriginal=await readFile(inactiveFile,'utf8');inactiveOutput=inactive==='cline'?disableCline(inactiveOriginal):disableCodex(inactiveOriginal);}catch(error){if(error.code!=='ENOENT')throw error;}
  const backup=await backedUpWrite(file,output);let inactiveBackup=null;if(inactiveOutput!=null&&inactiveOutput!==inactiveOriginal)inactiveBackup=await backedUpWrite(inactiveFile,inactiveOutput);
  const selectedName=client==='cline'?'Cline':'Codex',inactiveName=inactive==='cline'?'Cline':'Codex';return {client,active_client:client,configured:true,config_path:file,backup_path:backup,inactive_client:inactive,inactive_client_disabled:inactiveOutput!=null,inactive_backup_path:inactiveBackup,token_synchronized:true,reconnect_required:true,message:`${selectedName} selected. SPRITED connection in ${inactiveName} has been disabled. Restart or reconnect the client, then press Test Connection.`};
}

export const __test={updateCline,updateCodex,disableCline,disableCodex,validateTomlShape};
