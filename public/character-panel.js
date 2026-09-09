(() => {
  'use strict';
  const trigger=document.createElement('button');trigger.id='characterWorkflowBtn';trigger.textContent='Character & Animation';
  document.querySelector('.import-stack').prepend(trigger);
  const dialog=document.createElement('dialog');dialog.id='characterDialog';
  dialog.style.cssText='width:min(760px,94vw);max-height:90vh;overflow:auto;background:#292521;color:#eee;border:1px solid #a88962;border-radius:16px;padding:24px';
  dialog.innerHTML=`<form method="dialog"><button style="float:right">Close</button></form><h2>Character & Animation</h2>
  <p>Keep one reference. Create animation requests and process supplied videos.</p>
  <div style="display:flex;gap:20px;align-items:center"><img id="characterPreview" alt="Character reference" style="width:128px;height:128px;object-fit:contain;background:#45403b"><div>
  <label>Name <input id="characterName" value="Guardian" maxlength="120"></label><br><label>Load / replace reference <input id="characterFile" type="file" accept="image/png,image/webp"></label></div></div>
  <p><label>Animation type <select id="recipeType"></select></label> <button id="createRun">Create run</button></p>
  <p><label>Run <select id="animationRun"></select></label></p>
  <p id="recipeDescription"></p>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
  <label>Router <select id="routerMode"><option value="auto">AUTO</option><option value="manual_video">Manual video</option><option value="agent_router">External agent queue</option><option value="local_animation">Local model — not configured</option><option value="stub">Development placeholder</option></select></label>
  <label>Background <select id="runBackgroundMode"><option value="key">Remove key color</option><option value="keep">Keep alpha/background</option></select></label>
  <label>Source frames <input id="runSource" type="number" min="1" max="120"></label><label>Output frames <input id="runOutput" type="number" min="1" max="120"></label>
  <label>Canvas width <input id="runWidth" type="number" min="16" max="4096"></label><label>Canvas height <input id="runHeight" type="number" min="16" max="4096"></label>
  <label>Start seconds <input id="runStart" type="number" min="0" step="0.1"></label><label>End seconds <input id="runEnd" type="number" min="0" step="0.1"></label>
  <label>Alignment <select id="runAlignment"><option value="body">Body center</option><option value="rightFoot">Right foot estimate</option></select></label>
  <label>Key color <input id="runKey" type="color" value="#00ff00"></label>
  </div><p><label>Attach video <input id="runVideo" type="file" accept="video/mp4,video/webm,video/quicktime"></label></p>
  <p><button id="saveRunSettings">Save settings</button> <button id="generateRun">Generate / process</button> <button id="openRunEditor">Open in editor</button></p>
  <p><button id="approveRun">Approve result</button> <button id="rejectRun">Reject</button> <button id="regenerateRun">Regenerate request</button></p>
  <pre id="runStatus" style="white-space:pre-wrap;max-height:220px;overflow:auto" role="status"></pre>
  <p>Save the project to keep reference, requests and results. Use the existing editor preview and Export for PNG / Godot. Agent queue is available through CLI/API/MCP; this standalone window does not connect to an agent automatically.</p>`;
  document.body.append(dialog);dialog.addEventListener('keydown',e=>e.stopPropagation());dialog.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();});
  const $=id=>dialog.querySelector('#'+id),videos=new Map();let current=null;
  const call=(action,args={})=>window.SpritedCore.dispatch('workflow/'+action,args);
  const show=value=>$('runStatus').textContent=typeof value==='string'?value:JSON.stringify(value,null,2);
  const busy=async task=>{const controls=[...dialog.querySelectorAll('button,input,select')];controls.forEach(e=>e.disabled=true);try{await task();}catch(e){show(e.message||String(e));}finally{controls.forEach(e=>e.disabled=false);}};
  const need=()=>{if(!current)throw Error('Create or choose a run first');return current;};
  async function refresh(selected=current){
    const c=await call('character/show');if(c){$('characterPreview').src=c.reference_image;$('characterName').value=c.name;}else{$('characterPreview').removeAttribute('src');}
    const runs=await call('animation/list');$('animationRun').replaceChildren();
    for(const r of runs){const o=new Option(r.animation_type+' · '+r.status+' · '+r.id.slice(0,8),r.id);$('animationRun').add(o);}
    current=runs.some(r=>r.id===selected)?selected:runs.at(-1)?.id||null;
    if(current){$('animationRun').value=current;const r=runs.find(r=>r.id===current),o=r.options;
      for(const [key,input] of Object.entries({source_frames:'runSource',output_frames:'runOutput',canvas_width:'runWidth',canvas_height:'runHeight',alignment:'runAlignment',background_mode:'runBackgroundMode',background:'runKey',start:'runStart',end:'runEnd'}))$(input).value=o[key];
      $('routerMode').value=r.router_mode||'auto';$('recipeDescription').textContent=r.recipe_snapshot.motion_description;
      show({status:r.status,provider:r.selected_provider,decision:r.router_decision,validation:r.validation,warnings:r.warnings,errors:r.errors});
    }else show('Load a reference, then create a run.');
  }
  for(const recipe of SpritedWorkflow.recipes())$('recipeType').add(new Option(recipe.display_name,recipe.animation_type));
  trigger.onclick=()=>busy(async()=>{await refresh();dialog.showModal();});
  $('characterFile').onchange=()=>busy(async()=>{const file=$('characterFile').files[0];if(!file)return;if(file.size>9*1024*1024)throw Error('Reference is too large');const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});await call('character/set-reference',{src,name:$('characterName').value,path:file.name});await refresh();});
  $('characterName').onchange=()=>busy(async()=>{const c=await call('character/show');if(c)await call('character/set-reference',{src:c.reference_image,name:$('characterName').value,path:c.reference_image_path});});
  $('createRun').onclick=()=>busy(async()=>{const r=await call('animation/create',{animation_type:$('recipeType').value});await refresh(r.id);});
  $('animationRun').onchange=()=>busy(()=>refresh($('animationRun').value));
  async function configure(){const id=need();return call('animation/configure',{id,source_frames:Number($('runSource').value),output_frames:Number($('runOutput').value),canvas_width:Number($('runWidth').value),canvas_height:Number($('runHeight').value),alignment:$('runAlignment').value,background_mode:$('runBackgroundMode').value,background:$('runKey').value,start:Number($('runStart').value),end:Number($('runEnd').value)});}
  $('saveRunSettings').onclick=()=>busy(async()=>{await configure();await refresh();});
  $('runVideo').onchange=()=>busy(async()=>{const id=need(),file=$('runVideo').files[0];if(!file)return;if(file.size>250*1024*1024)throw Error('Video exceeds 250 MB');await call('animation/attach-video',{id,path:file.name});videos.set(id,file);await refresh();});
  $('generateRun').onclick=()=>busy(async()=>{const id=need(),provider=$('routerMode').value;await configure();await call('animation/route',{id,provider});const file=videos.get(id),url=file?URL.createObjectURL(file):null;show('Routing / processing…');try{await call('animation/process',{id,url});}finally{if(url)URL.revokeObjectURL(url);}await refresh();});
  $('openRunEditor').onclick=()=>busy(async()=>{await call('animation/open',{id:need()});dialog.close();});
  for(const [button,action] of [['approveRun','approve'],['rejectRun','reject'],['regenerateRun','regenerate']])$(button).onclick=()=>busy(async()=>{const r=await call('animation/'+action,{id:need()});await refresh(r.id);});
})();
