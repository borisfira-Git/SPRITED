(() => {
  'use strict';
  const remote=location.pathname.startsWith('/ui/');
  const token=remote?(location.hash.slice(1)||sessionStorage.getItem('sprited-token')):null;
  if(token){sessionStorage.setItem('sprited-token',token);history.replaceState(null,'',location.pathname);}
  const button=document.createElement('button');button.id='libraryBtn';button.textContent='Character Library';document.querySelector('.import-stack').prepend(button);
  const dialog=document.createElement('dialog');dialog.id='libraryDialog';dialog.style.cssText='width:min(900px,96vw);max-height:92vh;overflow:auto;background:#292521;color:#f4eee7;border:1px solid #aa8964;border-radius:14px;padding:24px';
  dialog.innerHTML=`<form method="dialog"><button style="float:right">Close</button></form><h2>Character Library</h2>
    <p id="libraryConnection"></p><p><select id="libraryCharacters" aria-label="Characters"></select> <button id="libraryRefresh">Refresh</button> <button id="libraryTrash">Trash</button> <button id="libraryDelete">Delete character</button> <button id="libraryRestore">Restore selected</button></p>
    <details><summary>+ NEW CHARACTER</summary><p><label>Name <input id="libraryName" maxlength="120" value="Guardian"></label> <input id="libraryReference" aria-label="New character reference" type="file" accept="image/png,image/webp"></p></details>
    <div style="display:flex;gap:24px;flex-wrap:wrap;margin-top:20px"><img id="libraryPreview" alt="Canonical reference" style="width:160px;height:160px;object-fit:contain;background:#403933"><div>
    <p><label>Animation <select id="libraryType"></select></label> <label>Duration (seconds) <input id="libraryDuration" type="number" value="1.6" min="0.3" max="5" step="0.1" style="width:85px"></label></p>
    <p><label>Loop <input id="libraryLoop" type="checkbox" checked></label> <label>Final frames <input id="libraryFrames" type="number" value="8" min="2" max="24" style="width:65px"></label> <label>Selection <select id="librarySampling"><option value="uniform">UNIFORM</option><option value="smart">SMART (uniform fallback)</option></select></label></p>
    <p><button id="libraryGenerate">GENERATE — queue for agent</button></p></div></div>
    <p><label>Attempts <select id="libraryAttempts"></select></label> <button id="libraryVideo">Preview video</button></p>
    <video id="libraryVideoPreview" controls playsinline style="width:100%;max-height:240px;background:#161412"></video>
    <p><button id="libraryRedo">REDO</button> <button id="libraryApprove">APPROVE</button> <button id="libraryReject">REJECT</button> <input id="libraryReason" placeholder="Rejection reason" aria-label="Rejection reason"></p>
    <p><button id="librarySheet">CREATE SPRITESHEET</button> <button id="libraryEditor">OPEN IN ADVANCED EDITOR</button></p>
    <pre id="libraryStatus" role="status" style="white-space:pre-wrap;max-height:210px;overflow:auto"></pre>
    <div id="libraryDownloads"></div>`;
  document.body.append(dialog);dialog.onkeydown=e=>e.stopPropagation();dialog.ondrop=e=>{e.preventDefault();e.stopPropagation();};
  const style=document.createElement('style');style.textContent='#libraryDialog label{font-size:13px;color:#e6d7c5}#libraryDialog button{padding:8px 12px;border:1px solid #876646;border-radius:6px;background:#49392d;color:#f8eadb;font-size:13px}#libraryDialog button:disabled{opacity:.55}#libraryDialog select,#libraryDialog input{font-size:14px;padding:6px;background:#211b17;color:#f8eadb;border:1px solid #765b45;border-radius:4px}#libraryDialog p{margin:14px 0}#libraryDialog::backdrop{background:#0009}';document.head.append(style);
  const purge=document.createElement('button');purge.id='libraryPurge';purge.textContent='Delete permanently';dialog.querySelector('#libraryRestore').after(purge);
  const $=id=>dialog.querySelector('#'+id);let active=null,attempt=null,inTrash=false,videoURL=null,busyNow=false;
  const reads=new Set(['character/list','character/trash','attempts/list','jobs/list','jobs/get','animation/status']);
  async function api(action,args={}){
    if(!remote||!token)throw Error('Open the connected library using automation/cli.mjs serve, then its printed Library URL. This shares persistent state with agents. The existing editor still works without the server.');
    let endpoint='/'+action;
    if(reads.has(action)&&action==='animation/status')endpoint='/generation-runs/'+args.id;
    const response=await fetch(endpoint,{method:reads.has(action)?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(!reads.has(action)?{body:JSON.stringify(args)}:{})});
    const data=await response.json();if(!data.success)throw Error(data.errors?.join('; ')||'Request failed');return data;
  }
  const show=v=>$('libraryStatus').textContent=typeof v==='string'?v:JSON.stringify(v,null,2);
  async function busy(task){if(busyNow)return;busyNow=true;const controls=[...dialog.querySelectorAll('button,input,select')];controls.forEach(e=>e.disabled=true);try{await task();}catch(e){show(e.message);}finally{busyNow=false;controls.forEach(e=>e.disabled=false);}}
  function need(){if(!active)throw Error('Create or choose a character');return active;}
  function needAttempt(){if(!attempt)throw Error('Choose an attempt');return attempt;}
  async function refresh(characterId=active,attemptId=attempt){
    const chars=(await api(inTrash?'character/trash':'character/list')).result;$('libraryCharacters').replaceChildren(...chars.map(c=>new Option(c.name+(inTrash?' (Trash)':''),c.id)));
    active=chars.some(c=>c.id===characterId)?characterId:chars[0]?.id||null;
    if(active){$('libraryCharacters').value=active;$('libraryPreview').src=chars.find(c=>c.id===active).reference_image;}else $('libraryPreview').removeAttribute('src');
    const runs=(await api('attempts/list')).result.filter(r=>r.character_profile_id===active);
    $('libraryAttempts').replaceChildren(...runs.map((r,i)=>new Option(`${r.animation_type} · Attempt ${i+1} · ${r.approval_state||r.status} · ${r.status}`,r.id)));
    attempt=runs.some(r=>r.id===attemptId)?attemptId:runs.at(-1)?.id||null;if(attempt)$('libraryAttempts').value=attempt;
    const selected=runs.find(r=>r.id===attempt);show(selected?{status:selected.status,approval:selected.approval_state,provider:selected.provider_metadata,spritesheets:selected.spritesheets?.length||0,warnings:selected.warnings,errors:selected.errors}:'Create a character, then queue an animation.');
    $('libraryDownloads').replaceChildren();
    for(const sheet of selected?.spritesheets||[]){const row=document.createElement('p');row.textContent=`${sheet.frame_count} frames · `;
      sheet.output_paths.forEach((file,index)=>{if(!file.endsWith('.png'))return;const b=document.createElement('button');b.textContent=file.split(/[\\/]/).at(-1);b.onclick=()=>busy(async()=>{const response=await fetch(`/sheets/${sheet.id}/asset/${index}`,{headers:{authorization:'Bearer '+token}});if(!response.ok)throw Error('Export file is unavailable');const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=b.textContent;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);});row.append(b);});$('libraryDownloads').append(row);}
  }
  for(const r of SpritedWorkflow.recipes())$('libraryType').add(new Option(r.display_name,r.animation_type));$('libraryType').value='WALKING';
  $('libraryType').onchange=()=>{const r=SpritedWorkflow.recipes().find(r=>r.animation_type===$('libraryType').value);$('libraryDuration').value=r.target_duration;$('libraryLoop').checked=r.loop;$('libraryFrames').value=r.default_output_frame_count;};
  $('libraryConnection').textContent=remote?'Connected local library · reference, videos and jobs persist in your workspace. Use Refresh to receive agent updates.':'The connected library is available through the local server. Your advanced editor remains available here.';
  button.onclick=()=>{dialog.showModal();busy(()=>refresh());};$('libraryRefresh').onclick=()=>busy(()=>refresh());
  $('libraryCharacters').onchange=()=>busy(()=>refresh($('libraryCharacters').value,null));$('libraryAttempts').onchange=()=>busy(()=>refresh(active,$('libraryAttempts').value));
  $('libraryReference').onchange=()=>busy(async()=>{const file=$('libraryReference').files[0];if(!file)return;if(!remote||!token)throw Error('Open the connected Library URL first');const response=await fetch('/ui/reference?name='+encodeURIComponent($('libraryName').value),{method:'POST',headers:{authorization:'Bearer '+token,'content-type':file.type},body:file});const r=await response.json();if(!r.success)throw Error(r.errors.join('; '));inTrash=false;await refresh(r.result.id);});
  $('libraryGenerate').onclick=()=>busy(async()=>{const r=await api('jobs/create',{character_id:need(),animation_type:$('libraryType').value,duration:Number($('libraryDuration').value),loop:$('libraryLoop').checked,frames:Number($('libraryFrames').value),sampling:$('librarySampling').value});await refresh(active,r.result.attempt_id);show({status:r.result.status,job_id:r.result.job_id,next:'An external agent must claim this job and generate a real video. No agent is launched automatically.'});});
  $('libraryRedo').onclick=()=>busy(async()=>{const r=await api('attempts/redo',{id:needAttempt()});await refresh(active,r.result.attempt_id);show({status:'QUEUED',job_id:r.result.job_id});});
  $('libraryApprove').onclick=()=>busy(async()=>{await api('animation/approve',{id:needAttempt()});await refresh();});
  $('libraryReject').onclick=()=>busy(async()=>{await api('attempts/reject',{id:needAttempt(),reason:$('libraryReason').value||'other'});await refresh();});
  $('libraryVideo').onclick=()=>busy(async()=>{const response=await fetch('/attempts/'+needAttempt()+'/video',{headers:{authorization:'Bearer '+token}});if(!response.ok)throw Error('No video received yet');if(videoURL)URL.revokeObjectURL(videoURL);videoURL=URL.createObjectURL(await response.blob());$('libraryVideoPreview').src=videoURL;});
  $('librarySheet').onclick=()=>busy(async()=>{show('Extracting, cleaning, aligning and building…');const r=await api('spritesheet/create',{id:needAttempt(),frames:Number($('libraryFrames').value),sampling:$('librarySampling').value});await refresh();show({status:r.status,warnings:r.warnings,message:'PNG sheet and individual PNG frames saved. Download buttons are below.'});});
  $('libraryEditor').onclick=()=>busy(async()=>{await api('animation/open',{id:needAttempt()});const response=await fetch('/ui/editor-project',{headers:{authorization:'Bearer '+token}});if(!response.ok)throw Error('Could not load editor result');await window.SpritedCore.dispatch('open',{project:await response.json()});dialog.close();});
  $('libraryTrash').onclick=()=>busy(async()=>{inTrash=!inTrash;await refresh(null,null);});
  $('libraryDelete').onclick=()=>busy(async()=>{const id=need(),name=$('libraryCharacters').selectedOptions[0].textContent;if(!confirm(`Move ${name} and its reference, videos, attempts, sprite sheets and preferences to Trash?`))return;await api('character/delete',{id,confirm_name:name});await refresh(null,null);});
  $('libraryRestore').onclick=()=>busy(async()=>{await api('character/restore',{id:need()});inTrash=false;await refresh();});
  purge.onclick=()=>busy(async()=>{if(!inTrash)throw Error('Move the character to Trash first');const id=need(),name=$('libraryCharacters').selectedOptions[0].textContent.replace(/ \(Trash\)$/,'');if(!confirm(`Permanently delete ${name}, including reference, videos, attempts, sheets and preferences? This cannot be undone.`))return;await api('character/purge',{id,confirm_name:name,confirm_delete:'DELETE PERMANENTLY'});await refresh(null,null);});
})();
