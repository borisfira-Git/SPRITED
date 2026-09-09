import {readFile,writeFile,unlink,stat,appendFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
const exec=promisify(execFile);
export async function inspectProcess(pid){
 if(!Number.isSafeInteger(pid)||pid<1)return {pid,exists:false};
 try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')return {pid,exists:false};if(e.code!=='EPERM')throw e;}
 if(process.platform!=='win32')return {pid,exists:true,executable:pid===process.pid?process.execPath:null,started_at:null,command_line:null};
 const script=`$ErrorActionPreference='Stop';$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue;if(!$p){'{"exists":false}';exit};$cmd=$null;try{$cmd=(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop).CommandLine}catch{};[pscustomobject]@{pid=[int]$p.Id;exists=$true;executable=$p.Path;started_at=$p.StartTime.ToUniversalTime().ToString('o');command_line=$cmd}|ConvertTo-Json -Compress`;
 try{const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:12000});return {pid,...JSON.parse(stdout.trim())};}catch{return {pid,exists:true,identity_unknown:true};}
}
export async function logStartup(root,event,details={}){await appendFile(path.join(root,'startup.log'),JSON.stringify({time:new Date().toISOString(),event,...details})+'\n').catch(()=>{});}
async function windowsGuard(lockPath){
 if(process.platform!=='win32')return ()=>{};
 const key=createHash('sha256').update(path.resolve(lockPath).toLowerCase()).digest('hex');
 const script='$m=New-Object Threading.Mutex($false,"Local\\SPRITED-lock-'+key+'");$owned=$false;try{try{$owned=$m.WaitOne(60000)}catch [Threading.AbandonedMutexException]{$owned=$true};if(!$owned){exit 2};[Console]::Out.WriteLine("ACQUIRED");[Console]::Out.Flush();$null=[Console]::In.ReadLine()}finally{if($owned){$m.ReleaseMutex()};$m.Dispose()}';
 const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 child.stdin.on('error',()=>{});
 await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>{child.stdin.end();reject(Error('Timed out waiting for workspace startup lock'));},65000);child.stdout.on('data',b=>{out+=b;if(out.includes('ACQUIRED')){clearTimeout(timer);resolve();}});child.once('error',e=>{clearTimeout(timer);reject(e)});child.once('exit',code=>{clearTimeout(timer);if(!out.includes('ACQUIRED'))reject(Error('Cannot acquire workspace startup guard ('+code+')'));});});
 return ()=>child.stdin.end();
}
export async function acquireLock(lockPath,root){const release=await windowsGuard(lockPath);try{return await acquireGuarded(lockPath,root);}finally{release();}}
async function acquireGuarded(lockPath,root){
 const me=await inspectProcess(process.pid);
 const record={format:2,pid:process.pid,executable:process.execPath,started_at:me.started_at||null,nonce:randomUUID()};const contents=JSON.stringify(record);
 for(let attempt=0;attempt<5;attempt++){
  try{await writeFile(lockPath,contents,{flag:'wx'});await logStartup(root,'lock-acquired',{lock_path:lockPath,pid:process.pid,executable:process.execPath});return contents;}catch(e){if(e.code!=='EEXIST')throw e;}
  let old;try{old=await readFile(lockPath,'utf8');}catch(e){if(e.code==='ENOENT')continue;throw e;}
  let owner;try{const parsed=JSON.parse(old);owner=typeof parsed==='number'?{pid:parsed}:parsed;}catch{owner={};}
  const observed=await inspectProcess(owner?.pid);
  let stale=!observed.exists;
  // Old releases wrote only a PID. A known unrelated executable/command is not SPRITED.
  if(observed.exists&&owner?.format===2){if(owner.started_at&&observed.started_at&&owner.started_at!==observed.started_at)stale=true;if(owner.executable&&observed.executable&&path.resolve(owner.executable).toLowerCase()!==path.resolve(observed.executable).toLowerCase())stale=true;}
  if(observed.exists&&owner?.format!==2){const lockInfo=await stat(lockPath);if(observed.started_at&&Date.parse(observed.started_at)>lockInfo.mtimeMs+100)stale=true;else if(observed.command_line)stale=!/[\\/]automation[\\/]cli\.mjs(?:["\s]|$)/i.test(observed.command_line);else if(observed.executable&&!/^node(?:\.exe)?$/i.test(path.basename(observed.executable)))stale=true;}
  if(!Number.isSafeInteger(owner?.pid)||owner.pid<1){const info=await stat(lockPath).catch(()=>null);if(info&&Date.now()-info.mtimeMs<30000){await new Promise(r=>setTimeout(r,500));if(await readFile(lockPath,'utf8').catch(()=>null)!==old)continue;}stale=true;}
  await logStartup(root,'lock-inspected',{lock_path:lockPath,pid:owner?.pid??null,process_exists:observed.exists,executable:observed.executable??'unknown',identity_unknown:!!observed.identity_unknown,stale});
  if(!stale)throw Error(observed.identity_unknown?'The workspace owner could not be verified. Check startup.log; no data or processes were changed.':'This workspace is in use by a live process. Reopen SPRITED to connect to its server, or close its active automation session.');
  // Recheck both content and owner immediately before deleting only this lock file.
  if(await readFile(lockPath,'utf8').catch(()=>null)!==old)continue;
  try{await unlink(lockPath);await logStartup(root,'stale-lock-removed',{lock_path:lockPath,pid:owner?.pid??null,cleanup:'removed automation.lock only; library data preserved'});}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 throw Error('Another startup changed the workspace lock. Please try opening SPRITED again.');
}
export async function releaseLock(lockPath,contents){if(await readFile(lockPath,'utf8').catch(()=>null)===contents)await unlink(lockPath).catch(e=>{if(e.code!=='ENOENT')throw e;});}
