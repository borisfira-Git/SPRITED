(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const images = new Map();
  const state = {
    projectName: "Untitled Animation", frames: [], selectedId: null, referenceId: null,
    canvasWidth: 512, canvasHeight: 512, groundRatio: .88, fps: 12, loop: true,
    playing: false, zoom: 1, tool: "move", grid: true, ground: true, bounds: true,
    sliceImage: null, sliceName: "", history: [], future: []
  };
  const canvas = $("#editorCanvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let pointerDrag = null, draggedId = null, playTimer = null;

  function loadImage(src) {
    if (images.has(src)) return images.get(src);
    const promise = new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src;
    });
    images.set(src, promise); return promise;
  }
  function readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
    });
  }
  function selected() { return state.frames.find((f) => f.id === state.selectedId) || null; }
  function reference() { return state.frames.find((f) => f.id === state.referenceId) || null; }
  function snapshot() {
    return {
      version: 1, projectName: state.projectName,
      frames: state.frames.map((f) => ({ ...f, charBounds: { ...f.charBounds }, alphaBounds: { ...f.alphaBounds } })),
      selectedId: state.selectedId, referenceId: state.referenceId, canvasWidth: state.canvasWidth,
      canvasHeight: state.canvasHeight, groundRatio: state.groundRatio, fps: state.fps, loop: state.loop
    };
  }
  function restore(data) {
    stop(); Object.assign(state, data, { frames: data.frames || [], playing: false });
    images.clear(); syncInputs(); renderAll();
  }
  function commit() {
    state.history.push(snapshot()); if (state.history.length > 50) state.history.shift();
    state.future.length = 0; $("#saveState").textContent = "Unsaved changes"; updateHistory();
  }
  function undo() {
    if (!state.history.length) return; state.future.push(snapshot()); restore(state.history.pop()); updateHistory();
  }
  function redo() {
    if (!state.future.length) return; state.history.push(snapshot()); restore(state.future.pop()); updateHistory();
  }
  function updateHistory() { $("#undoBtn").disabled = !state.history.length; $("#redoBtn").disabled = !state.future.length; }
  function toast(text, type = "") {
    const el = $("#toast"); el.textContent = text; el.className = `toast ${type}`;
    clearTimeout(el._timer); el._timer = setTimeout(() => el.classList.add("hidden"), 2600);
  }
  function status(text) { $("#status").textContent = text; }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function canvasBlob(c) { return new Promise((resolve) => c.toBlob(resolve, "image/png")); }
  async function alphaBounds(source) {
    const image = typeof source === "string" ? await loadImage(source) : source;
    const c = document.createElement("canvas"); c.width = image.naturalWidth; c.height = image.naturalHeight;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(image, 0, 0);
    const data = x.getImageData(0, 0, c.width, c.height).data;
    let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
    for (let y = 0; y < c.height; y++) for (let px = 0; px < c.width; px++) {
      if (data[(y * c.width + px) * 4 + 3] > 8) {
        minX = Math.min(minX, px); minY = Math.min(minY, y); maxX = Math.max(maxX, px); maxY = Math.max(maxY, y);
      }
    }
    if (maxX < minX) return { x: 0, y: 0, w: c.width, h: c.height, empty: true };
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }
  async function makeFrame(src, name) {
    const image = await loadImage(src), b = await alphaBounds(image);
    const bounds = { x: b.x, y: b.y, w: b.w, h: b.h };
    return {
      id: uid(), name, src, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight,
      x: 0, y: 0, scale: 1, rotation: 0, duration: Math.round(1000 / state.fps),
      charBounds: { ...bounds }, alphaBounds: { ...bounds }
    };
  }
  function drawRect(frame) {
    const w = frame.sourceWidth * frame.scale, h = frame.sourceHeight * frame.scale;
    return { x: state.canvasWidth / 2 - w / 2 + frame.x, y: state.canvasHeight / 2 - h / 2 + frame.y, w, h };
  }
  function renderedBounds(frame) {
    const d = drawRect(frame), b = frame.charBounds;
    return { x: d.x + b.x * frame.scale, y: d.y + b.y * frame.scale, w: b.w * frame.scale, h: b.h * frame.scale };
  }
  async function drawFrame(target, frame, overlays = false) {
    target.clearRect(0, 0, state.canvasWidth, state.canvasHeight);
    if (frame) {
      const image = await loadImage(frame.src), d = drawRect(frame);
      target.save(); target.translate(d.x + d.w / 2, d.y + d.h / 2);
      target.rotate(frame.rotation * Math.PI / 180); target.drawImage(image, -d.w / 2, -d.h / 2, d.w, d.h); target.restore();
    }
    if (!overlays) return;
    target.save();
    if (state.grid) {
      target.strokeStyle = "rgba(255,255,255,.15)"; target.setLineDash([5, 7]); target.beginPath();
      target.moveTo(state.canvasWidth / 2, 0); target.lineTo(state.canvasWidth / 2, state.canvasHeight);
      target.moveTo(0, state.canvasHeight / 2); target.lineTo(state.canvasWidth, state.canvasHeight / 2); target.stroke();
    }
    if (state.ground) {
      const y = state.canvasHeight * state.groundRatio;
      target.setLineDash([]); target.strokeStyle = "#57d99b"; target.beginPath(); target.moveTo(0, y); target.lineTo(state.canvasWidth, y); target.stroke();
      target.fillStyle = "#57d99b"; target.font = "11px system-ui"; target.fillText("GROUND", 8, y - 7);
    }
    if (state.bounds && frame) {
      const b = renderedBounds(frame); target.setLineDash([6, 4]); target.strokeStyle = "#ff984b"; target.fillStyle = "rgba(255,138,61,.08)";
      target.lineWidth = 2; target.fillRect(b.x, b.y, b.w, b.h); target.strokeRect(b.x, b.y, b.w, b.h); target.setLineDash([]);
      [[b.x,b.y],[b.x+b.w,b.y],[b.x,b.y+b.h],[b.x+b.w,b.y+b.h]].forEach(([x,y]) => {
        target.fillStyle = "#15100e"; target.strokeStyle = "#ffb06b"; target.fillRect(x-4,y-4,8,8); target.strokeRect(x-4,y-4,8,8);
      });
    }
    target.restore();
  }
  function renderCanvas() {
    canvas.width = state.canvasWidth; canvas.height = state.canvasHeight;
    canvas.style.width = `${state.canvasWidth * state.zoom}px`; canvas.style.height = `${state.canvasHeight * state.zoom}px`;
    $("#fitBtn").textContent = `${Math.round(state.zoom * 100)}%`;
    $("#emptyState").classList.toggle("hidden", !!state.frames.length);
    $("#canvasWrap").classList.toggle("hidden", !state.frames.length);
    $("#canvasStatus").textContent = `Canvas ${state.canvasWidth} × ${state.canvasHeight}`;
    drawFrame(ctx, selected(), true);
  }
  function escapeHtml(value) { const e = document.createElement("span"); e.textContent = value; return e.innerHTML; }
  function renderFrames() {
    $("#framesList").innerHTML = state.frames.map((f, i) => `
      <button class="frame-item ${f.id === state.selectedId ? "selected" : ""}" data-id="${f.id}" draggable="true">
        <span class="drag-handle">⠿</span><span class="thumb checker"><img src="${f.src}" alt=""></span>
        <span class="frame-copy"><strong>${escapeHtml(f.name || `Frame ${i+1}`)}</strong><small>${f.sourceWidth} × ${f.sourceHeight} · ${f.duration} ms</small>
        <em><i></i>${f.id === state.referenceId ? "REFERENCE" : "READY"}</em></span>
        <span class="star ${f.id === state.referenceId ? "active" : ""}">★</span>
      </button>`).join("");
    $("#timelineFrames").innerHTML = state.frames.map((f, i) => `<button data-id="${f.id}" class="${f.id === state.selectedId ? "active" : ""}"><img src="${f.src}" alt=""><span>${i+1}</span></button>`).join("");
    $("#frameCount").textContent = state.frames.length;
    const i = Math.max(0, state.frames.findIndex((f) => f.id === state.selectedId));
    $("#frameReadout").textContent = state.frames.length ? `${i+1} / ${state.frames.length}` : "0 / 0";
    const ms = state.frames.slice(0, i+1).reduce((n,f) => n + f.duration, 0);
    $("#timeReadout").textContent = `${String(Math.floor(ms/60000)).padStart(2,"0")}:${String(Math.floor(ms%60000/1000)).padStart(2,"0")}.${String(ms%1000).padStart(3,"0")}`;
    $$("#framesList .frame-item").forEach((el) => {
      el.onclick = (event) => {
        if (event.target.closest(".star")) { commit(); state.referenceId = el.dataset.id; }
        state.selectedId = el.dataset.id; renderAll();
      };
      el.ondragstart = () => draggedId = el.dataset.id;
      el.ondragover = (event) => event.preventDefault();
      el.ondrop = () => {
        if (!draggedId || draggedId === el.dataset.id) return; commit();
        const from = state.frames.findIndex((f) => f.id === draggedId), to = state.frames.findIndex((f) => f.id === el.dataset.id);
        const [moved] = state.frames.splice(from, 1); state.frames.splice(to, 0, moved); draggedId = null; renderAll();
      };
    });
    $$("#timelineFrames button").forEach((el) => el.onclick = () => { state.selectedId = el.dataset.id; renderAll(); });
  }
  function renderInspector() {
    const f = selected(), i = state.frames.indexOf(f);
    $("#inspectorEmpty").classList.toggle("hidden", !!f); $("#inspector").classList.toggle("hidden", !f); $("#resetBtn").disabled = !f;
    $("#inspectorTitle").textContent = f ? `Frame ${i+1}` : "No frame selected";
    if (!f) return;
    $("#propX").value = Math.round(f.x*100)/100; $("#propY").value = Math.round(f.y*100)/100;
    $("#propScale").value = Math.round(f.scale*1000)/1000; $("#propRotation").value = f.rotation;
    $("#boundX").value = Math.round(f.charBounds.x); $("#boundY").value = Math.round(f.charBounds.y);
    $("#boundW").value = Math.round(f.charBounds.w); $("#boundH").value = Math.round(f.charBounds.h);
    $("#durationInput").value = f.duration; $("#matchBtn").disabled = !reference() || reference().id === f.id;
  }
  function updateExport() {
    const columns = clamp(Number($("#exportColumns").value)||1,1,Math.max(1,state.frames.length)), rows = Math.ceil(state.frames.length/columns);
    $("#exportSummary").textContent = `${state.frames.length} frames · ${columns} × ${rows} grid`;
    $("#exportDimensions").textContent = state.frames.length ? `${state.canvasWidth*columns} × ${state.canvasHeight*rows} px · transparent PNG` : "Add frames before exporting";
  }
  function renderAll() { renderFrames(); renderInspector(); renderCanvas(); updateExport(); updateHistory(); }
  function syncInputs() {
    $("#projectName").value = state.projectName; $("#canvasWidth").value = state.canvasWidth; $("#canvasHeight").value = state.canvasHeight;
    $("#groundLine").value = state.groundRatio*100; $("#groundOutput").textContent = `${Math.round(state.groundRatio*100)}%`;
    $("#fpsInput").value = state.fps; $("#loopBtn").classList.toggle("active", state.loop);
  }
  async function importFrames(files) {
    const list = [...files].filter((f) => f.type.startsWith("image/")); if (!list.length) return;
    commit(); status(`Importing ${list.length} frames…`); const created = [];
    for (const file of list) created.push(await makeFrame(await readDataUrl(file), file.name.replace(/\.[^.]+$/,"")));
    state.frames.push(...created); state.selectedId ||= created[0].id; state.referenceId ||= created[0].id;
    status("Frames imported"); renderAll(); fitZoom(); toast(`${created.length} frames imported`, "success");
  }
  async function openSlicer(file) {
    if (!file) return; const src = await readDataUrl(file), image = await loadImage(src), ratio = image.naturalWidth/image.naturalHeight;
    state.sliceImage = image; state.sliceName = file.name.replace(/\.[^.]+$/,"");
    $("#sliceCols").value = ratio > 2.5 ? Math.max(1,Math.round(ratio)) : ratio < .45 ? 1 : 2;
    $("#sliceRows").value = ratio < .45 ? Math.max(1,Math.round(1/ratio)) : Math.max(1,Math.round(Number($("#sliceCols").value)*image.naturalHeight/image.naturalWidth));
    $("#sliceModal").classList.remove("hidden"); renderSlice();
  }
  function sliceGeometry() {
    const cols=Math.max(1,Number($("#sliceCols").value)||1), rows=Math.max(1,Number($("#sliceRows").value)||1), gapX=Math.max(0,Number($("#sliceGapX").value)||0), gapY=Math.max(0,Number($("#sliceGapY").value)||0), marginX=Math.max(0,Number($("#sliceMarginX").value)||0), marginY=Math.max(0,Number($("#sliceMarginY").value)||0);
    return {cols,rows,gapX,gapY,marginX,marginY,cellW:Math.floor((state.sliceImage.naturalWidth-marginX-gapX*(cols-1))/cols),cellH:Math.floor((state.sliceImage.naturalHeight-marginY-gapY*(rows-1))/rows)};
  }
  function renderSlice() {
    if (!state.sliceImage) return; const c=$("#sliceCanvas"), image=state.sliceImage, ratio=Math.min(700/image.naturalWidth,420/image.naturalHeight,1), g=sliceGeometry();
    c.width=Math.round(image.naturalWidth*ratio); c.height=Math.round(image.naturalHeight*ratio); const x=c.getContext("2d");
    x.drawImage(image,0,0,c.width,c.height); x.save(); x.scale(ratio,ratio); x.fillStyle="rgba(255,138,61,.08)"; x.strokeStyle="#ff984b"; x.lineWidth=2/ratio;
    for(let r=0;r<g.rows;r++)for(let col=0;col<g.cols;col++){const px=g.marginX+col*(g.cellW+g.gapX),py=g.marginY+r*(g.cellH+g.gapY);x.fillRect(px,py,g.cellW,g.cellH);x.strokeRect(px,py,g.cellW,g.cellH)} x.restore();
    $("#sliceSize").textContent=`${g.cellW} × ${g.cellH} px`; $("#sliceCount").textContent=`${g.cols*g.rows} frames`;
  }
  async function confirmSlice() {
    const g=sliceGeometry(); if(g.cellW<1||g.cellH<1)return toast("The grid does not fit the image","error");
    commit(); status("Slicing sprite sheet…"); const created=[];
    for(let r=0;r<g.rows;r++)for(let col=0;col<g.cols;col++){const c=document.createElement("canvas");c.width=g.cellW;c.height=g.cellH;c.getContext("2d").drawImage(state.sliceImage,g.marginX+col*(g.cellW+g.gapX),g.marginY+r*(g.cellH+g.gapY),g.cellW,g.cellH,0,0,g.cellW,g.cellH);created.push(await makeFrame(c.toDataURL("image/png"),`${state.sliceName} ${String(created.length+1).padStart(2,"0")}`))}
    state.frames.push(...created);state.selectedId ||= created[0]?.id;state.referenceId ||= created[0]?.id;$("#sliceModal").classList.add("hidden");status("Sprite sheet sliced");renderAll();fitZoom();toast(`${created.length} frames created`,"success");
  }
  function centerPatch(f){const b=renderedBounds(f);return{x:f.x+state.canvasWidth/2-(b.x+b.w/2)}}
  function groundPatch(f,target=state.canvasHeight*state.groundRatio){const b=renderedBounds(f);return{y:f.y+target-(b.y+b.h)}}
  function match(f,ref){const scaled={...f,scale:ref.charBounds.h*ref.scale/Math.max(1,f.charBounds.h)};const centered={...scaled,...centerPatch(scaled)};const rb=renderedBounds(ref);return{...centered,...groundPatch(centered,rb.y+rb.h)}}
  function normalize() {
    let ref=reference();if(!ref)return toast("Choose a reference frame first","error");commit();ref={...ref,...centerPatch(ref)};ref={...ref,...groundPatch(ref)};
    state.frames=state.frames.map(f=>f.id===ref.id?ref:match(f,ref));renderAll();toast(`Normalized ${state.frames.length} frames`,"success");
  }
  async function detectBounds(){const f=selected();if(!f)return;commit();const b=await alphaBounds(f.src);f.charBounds={x:b.x,y:b.y,w:b.w,h:b.h};f.alphaBounds={...f.charBounds};renderAll();toast("Character box detected")}
  async function trim(){const f=selected();if(!f)return;const b=await alphaBounds(f.src);if(b.empty)return toast("This frame is empty","error");commit();const image=await loadImage(f.src),c=document.createElement("canvas");c.width=b.w;c.height=b.h;c.getContext("2d").drawImage(image,b.x,b.y,b.w,b.h,0,0,b.w,b.h);f.src=c.toDataURL("image/png");f.sourceWidth=b.w;f.sourceHeight=b.h;f.alphaBounds={x:0,y:0,w:b.w,h:b.h};f.charBounds={x:clamp(f.charBounds.x-b.x,0,b.w-1),y:clamp(f.charBounds.y-b.y,0,b.h-1),w:Math.min(f.charBounds.w,b.w),h:Math.min(f.charBounds.h,b.h)};images.clear();renderAll();toast("Transparent margins trimmed","success")}
  function hex(hex){return{r:parseInt(hex.slice(1,3),16),g:parseInt(hex.slice(3,5),16),b:parseInt(hex.slice(5,7),16)}}
  async function removeBackground(all) {
    const targets=all?state.frames:[selected()].filter(Boolean);if(!targets.length)return;commit();status(`Removing background from ${targets.length} frames…`);
    const target=hex($("#bgColor").value),tol=Number($("#tolerance").value),soft=Number($("#softness").value);
    for(const f of targets){const image=await loadImage(f.src),c=document.createElement("canvas");c.width=image.naturalWidth;c.height=image.naturalHeight;const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(image,0,0);const id=x.getImageData(0,0,c.width,c.height),d=id.data;for(let i=0;i<d.length;i+=4){const dr=d[i]-target.r,dg=d[i+1]-target.g,db=d[i+2]-target.b,dist=Math.sqrt(dr*dr+dg*dg+db*db);if(dist<=tol)d[i+3]=0;else if(dist<tol+soft&&soft>0)d[i+3]=Math.round(d[i+3]*(dist-tol)/soft);if(d[i+1]>d[i]*1.15&&d[i+1]>d[i+2]*1.15&&dist<tol+soft*2)d[i+1]=Math.max(d[i],d[i+2])}x.putImageData(id,0,0);f.src=c.toDataURL("image/png");const b=await alphaBounds(f.src);f.alphaBounds={x:b.x,y:b.y,w:b.w,h:b.h};f.charBounds={...f.alphaBounds}}
    images.clear();status("Background removed");renderAll();toast("Background removed","success");
  }
  function fitFrame(){const f=selected();if(!f)return;commit();const b=f.alphaBounds,scale=Math.min(state.canvasWidth*.88/b.w,state.canvasHeight*.88/b.h,1),tmp={...f,scale,x:0,y:0},rb=renderedBounds(tmp);Object.assign(f,{scale,x:state.canvasWidth/2-(rb.x+rb.w/2),y:state.canvasHeight/2-(rb.y+rb.h/2)});renderAll()}
  function step(dir){if(!state.frames.length)return;const i=Math.max(0,state.frames.findIndex(f=>f.id===state.selectedId)),n=state.loop?(i+dir+state.frames.length)%state.frames.length:clamp(i+dir,0,state.frames.length-1);state.selectedId=state.frames[n].id;renderAll()}
  function stop(){state.playing=false;clearTimeout(playTimer);$("#playBtn").textContent="▶"}
  function play(){if(!state.frames.length)return;state.playing=!state.playing;$("#playBtn").textContent=state.playing?"Ⅱ":"▶";if(state.playing)playStep();else stop()}
  function playStep(){if(!state.playing)return;const f=selected()||state.frames[0];playTimer=setTimeout(()=>{const i=state.frames.indexOf(f);if(!state.loop&&i===state.frames.length-1)return stop();step(1);playStep()},f.duration||1000/state.fps)}
  async function renderedFrame(f){const c=document.createElement("canvas");c.width=state.canvasWidth;c.height=state.canvasHeight;await drawFrame(c.getContext("2d"),f,false);return c}
  function prefix(){return($("#exportPrefix").value||state.projectName||"animation").trim().replace(/[^\w-]+/g,"_").replace(/^_+|_+$/g,"").toLowerCase()||"animation"}
  function metadata(cols){return{animation:prefix(),fps:state.fps,loop:state.loop,frame_width:state.canvasWidth,frame_height:state.canvasHeight,frames:state.frames.length,horizontal_frames:Math.min(cols,state.frames.length),vertical_frames:Math.ceil(state.frames.length/cols),durations_ms:state.frames.map(f=>f.duration),reference_frame:Math.max(0,state.frames.findIndex(f=>f.id===state.referenceId))}}
  async function exportSheet(){if(!state.frames.length)return;const cols=clamp(Number($("#exportColumns").value)||1,1,state.frames.length),rows=Math.ceil(state.frames.length/cols),c=document.createElement("canvas");c.width=state.canvasWidth*cols;c.height=state.canvasHeight*rows;const x=c.getContext("2d");status("Rendering sprite sheet…");for(let i=0;i<state.frames.length;i++)x.drawImage(await renderedFrame(state.frames[i]),i%cols*state.canvasWidth,Math.floor(i/cols)*state.canvasHeight);download(await canvasBlob(c),`${prefix()}_${cols}x${rows}.png`);download(new Blob([JSON.stringify(metadata(cols),null,2)],{type:"application/json"}),`${prefix()}.json`);$("#exportModal").classList.add("hidden");status("Sprite sheet exported");toast(`Exported ${c.width} × ${c.height} sprite sheet`,"success")}
  async function exportFrames(){if(!state.frames.length)return;let dir=null;if(window.showDirectoryPicker){try{dir=await window.showDirectoryPicker({mode:"readwrite"})}catch{return}}for(let i=0;i<state.frames.length;i++){const blob=await canvasBlob(await renderedFrame(state.frames[i])),name=`${prefix()}_${String(i+1).padStart(3,"0")}.png`;if(dir){const h=await dir.getFileHandle(name,{create:true}),w=await h.createWritable();await w.write(blob);await w.close()}else{download(blob,name);await new Promise(r=>setTimeout(r,80))}}toast(`${state.frames.length} frames exported`,"success");$("#exportModal").classList.add("hidden")}
  function saveProject(){state.projectName=$("#projectName").value.trim()||"Untitled Animation";download(new Blob([JSON.stringify(snapshot())],{type:"application/json"}),`${state.projectName.replace(/[^\w-]+/g,"_").toLowerCase()}.spriteproject`);$("#saveState").textContent="Saved locally";toast("Project saved","success")}
  async function openProject(file){try{const data=JSON.parse(await file.text());if(!Array.isArray(data.frames))throw Error();state.history=[];state.future=[];restore(data);$("#saveState").textContent="Saved locally";toast("Project opened","success")}catch{toast("Could not open this project","error")}}
  function fitZoom(){const r=$("#canvasStage").getBoundingClientRect();state.zoom=clamp(Math.min((r.width-90)/state.canvasWidth,(r.height-90)/state.canvasHeight),.1,2);renderCanvas()}
  function bindNumber(id,cb){$(id).onchange=e=>{const v=Number(e.target.value);if(Number.isFinite(v))cb(v)}}
  function bind() {
    $("#sheetBtn").onclick=$("#emptySheetBtn").onclick=()=>$("#sheetInput").click();
    $("#framesBtn").onclick=$("#emptyFramesBtn").onclick=$("#addFramesBtn").onclick=()=>$("#framesInput").click();
    $("#sheetInput").onchange=e=>{openSlicer(e.target.files[0]);e.target.value=""};$("#framesInput").onchange=e=>{importFrames(e.target.files);e.target.value=""};
    $("#openBtn").onclick=()=>$("#projectInput").click();$("#projectInput").onchange=e=>{if(e.target.files[0])openProject(e.target.files[0]);e.target.value=""};
    $("#saveBtn").onclick=saveProject;$("#newBtn").onclick=()=>{if(state.frames.length&&!confirm("Start a new project? Unsaved work will be cleared."))return;restore({version:1,projectName:"Untitled Animation",frames:[],selectedId:null,referenceId:null,canvasWidth:512,canvasHeight:512,groundRatio:.88,fps:12,loop:true});state.history=[];state.future=[]};
    $("#undoBtn").onclick=undo;$("#redoBtn").onclick=redo;
    $("#exportBtn").onclick=()=>{$("#exportPrefix").value=state.projectName==="Untitled Animation"?"animation":state.projectName;updateExport();$("#exportModal").classList.remove("hidden")};
    $("#firstBtn").onclick=()=>{if(state.frames[0]){state.selectedId=state.frames[0].id;renderAll()}};$("#reverseBtn").onclick=()=>{if(state.frames.length>1){commit();state.frames.reverse();renderAll()}};
    $("#duplicateBtn").onclick=()=>{const f=selected();if(!f)return;commit();const copy={...f,id:uid(),name:`${f.name} copy`,charBounds:{...f.charBounds},alphaBounds:{...f.alphaBounds}},i=state.frames.indexOf(f);state.frames.splice(i+1,0,copy);state.selectedId=copy.id;renderAll()};
    $("#deleteBtn").onclick=()=>{const f=selected();if(!f)return;commit();const i=state.frames.indexOf(f);state.frames.splice(i,1);if(state.referenceId===f.id)state.referenceId=state.frames[0]?.id||null;state.selectedId=state.frames[Math.min(i,state.frames.length-1)]?.id||null;renderAll()};
    bindNumber("#propX",v=>{const f=selected();commit();f.x=v;renderAll()});bindNumber("#propY",v=>{const f=selected();commit();f.y=v;renderAll()});bindNumber("#propScale",v=>{const f=selected();commit();f.scale=clamp(v,.05,10);renderAll()});bindNumber("#propRotation",v=>{const f=selected();commit();f.rotation=v;renderAll()});
    [["#boundX","x"],["#boundY","y"],["#boundW","w"],["#boundH","h"]].forEach(([id,key])=>bindNumber(id,v=>{const f=selected();commit();f.charBounds[key]=["w","h"].includes(key)?Math.max(1,v):v;renderAll()}));
    bindNumber("#durationInput",v=>{const f=selected();commit();f.duration=Math.max(10,v);renderAll()});
    $("#centerBtn").onclick=()=>{const f=selected();commit();Object.assign(f,centerPatch(f));renderAll()};$("#alignBtn").onclick=()=>{const f=selected();commit();Object.assign(f,groundPatch(f));renderAll()};
    $("#detectBtn").onclick=detectBounds;$("#referenceBtn").onclick=()=>{const f=selected();commit();state.referenceId=f.id;renderAll()};$("#matchBtn").onclick=()=>{const f=selected(),r=reference();if(!f||!r)return;commit();Object.assign(f,match(f,r));renderAll()};
    $("#trimBtn").onclick=trim;$("#fitFrameBtn").onclick=fitFrame;$("#normalizeBtn").onclick=normalize;$("#resetBtn").onclick=()=>{const f=selected();if(!f)return;commit();Object.assign(f,{x:0,y:0,scale:1,rotation:0,charBounds:{...f.alphaBounds}});renderAll()};
    bindNumber("#canvasWidth",v=>{commit();state.canvasWidth=clamp(v,16,4096);renderAll();fitZoom()});bindNumber("#canvasHeight",v=>{commit();state.canvasHeight=clamp(v,16,4096);renderAll();fitZoom()});
    $("#groundLine").oninput=e=>{state.groundRatio=Number(e.target.value)/100;$("#groundOutput").textContent=`${e.target.value}%`;renderCanvas()};
    $("#softness").oninput=e=>$("#softOutput").textContent=e.target.value;$("#removeBgBtn").onclick=()=>removeBackground(false);$("#removeBgAllBtn").onclick=()=>removeBackground(true);
    bindNumber("#fpsInput",v=>{commit();state.fps=clamp(v,1,60);state.frames.forEach(f=>f.duration=Math.round(1000/state.fps));renderAll()});$("#loopBtn").onclick=()=>{state.loop=!state.loop;$("#loopBtn").classList.toggle("active",state.loop)};
    $("#previousBtn").onclick=()=>step(-1);$("#nextBtn").onclick=()=>step(1);$("#playBtn").onclick=play;
    $("#gridBtn").onclick=()=>{state.grid=!state.grid;$("#gridBtn").classList.toggle("active",state.grid);renderCanvas()};$("#groundBtn").onclick=()=>{state.ground=!state.ground;$("#groundBtn").classList.toggle("active",state.ground);renderCanvas()};$("#boundsBtn").onclick=()=>{state.bounds=!state.bounds;$("#boundsBtn").classList.toggle("active",state.bounds);renderCanvas()};
    $$("[data-tool]").forEach(b=>b.onclick=()=>{state.tool=b.dataset.tool;$$("[data-tool]").forEach(x=>x.classList.toggle("active",x===b))});
    $("#zoomInBtn").onclick=()=>{state.zoom=clamp(state.zoom+.1,.1,4);renderCanvas()};$("#zoomOutBtn").onclick=()=>{state.zoom=clamp(state.zoom-.1,.1,4);renderCanvas()};$("#fitBtn").onclick=fitZoom;
    ["#sliceCols","#sliceRows","#sliceGapX","#sliceGapY","#sliceMarginX","#sliceMarginY"].forEach(id=>$(id).oninput=renderSlice);$("#confirmSliceBtn").onclick=confirmSlice;
    $$("[data-close]").forEach(b=>b.onclick=()=>$("#"+b.dataset.close).classList.add("hidden"));$("#exportColumns").oninput=updateExport;$("#exportSheetBtn").onclick=exportSheet;$("#exportFramesBtn").onclick=exportFrames;
    $$(".section-title").forEach(b=>b.onclick=()=>{const body=b.nextElementSibling;body.classList.toggle("hidden");b.lastElementChild.textContent=body.classList.contains("hidden")?"⌄":"⌃"});
    $("#projectName").oninput=e=>{state.projectName=e.target.value;$("#saveState").textContent="Unsaved changes"};
    canvas.onpointerdown=e=>{const f=selected();if(!f)return;commit();const r=canvas.getBoundingClientRect(),p={x:(e.clientX-r.left)/r.width*state.canvasWidth,y:(e.clientY-r.top)/r.height*state.canvasHeight};pointerDrag={p,x:f.x,y:f.y,b:{...f.charBounds}};canvas.setPointerCapture(e.pointerId)};
    canvas.onpointermove=e=>{const f=selected();if(!f||!pointerDrag)return;const r=canvas.getBoundingClientRect(),p={x:(e.clientX-r.left)/r.width*state.canvasWidth,y:(e.clientY-r.top)/r.height*state.canvasHeight},dx=p.x-pointerDrag.p.x,dy=p.y-pointerDrag.p.y;if(state.tool==="move"){f.x=pointerDrag.x+dx;f.y=pointerDrag.y+dy}else{f.charBounds.x=pointerDrag.b.x+dx/f.scale;f.charBounds.y=pointerDrag.b.y+dy/f.scale}renderInspector();renderCanvas()};canvas.onpointerup=()=>pointerDrag=null;
    window.ondragover=e=>e.preventDefault();window.ondrop=e=>{e.preventDefault();const fs=[...e.dataTransfer.files].filter(f=>f.type.startsWith("image/"));if(fs.length===1)openSlicer(fs[0]);else importFrames(fs)};
    window.onkeydown=e=>{const typing=["INPUT","TEXTAREA"].includes(document.activeElement?.tagName);if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();e.shiftKey?redo():undo()}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();redo()}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();saveProject()}else if(!typing&&e.code==="Space"){e.preventDefault();play()}else if(!typing&&e.key==="ArrowRight")step(1);else if(!typing&&e.key==="ArrowLeft")step(-1)};
  }
  bind(); syncInputs(); renderAll();
})();
