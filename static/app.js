(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const images = new Map();
  const state = {
    projectName: "Untitled Animation", frames: [], selectedId: null, selectedIds: [], selectionAnchorId: null, referenceId: null,
    canvasWidth: 512, canvasHeight: 512, groundRatio: .88, anchorRatio: .5, targetHeightRatio: .72, rulerBottomRatio: .88, fps: 12, loop: true,
    playing: false, zoom: 1, tool: "move", grid: true, ground: true, guides: true, bounds: true,
    sliceImage: null, sliceName: "", history: [], future: []
  };
  const canvas = $("#editorCanvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let pointerDrag = null, draggedId = null, playTimer = null, scaleWheelTimer = null, scaleWheelHistoryOpen = false, defaultExportDirectory = null;
  const keysDown = new Set();

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
      selectedId: state.selectedId, selectedIds: [...state.selectedIds], selectionAnchorId: state.selectionAnchorId,
      referenceId: state.referenceId, canvasWidth: state.canvasWidth,
      canvasHeight: state.canvasHeight, groundRatio: state.groundRatio, anchorRatio: state.anchorRatio,
      targetHeightRatio: state.targetHeightRatio, rulerBottomRatio: state.rulerBottomRatio, fps: state.fps, loop: state.loop
    };
  }
  function restore(data) {
    stop(); Object.assign(state, data, {
      frames: data.frames || [],
      selectedIds: data.selectedIds?.length ? data.selectedIds : (data.selectedId ? [data.selectedId] : []),
      selectionAnchorId: data.selectionAnchorId || data.selectedId || null,
      anchorRatio: data.anchorRatio ?? .5,
      targetHeightRatio: data.targetHeightRatio ?? .72,
      rulerBottomRatio: clamp(data.rulerBottomRatio ?? data.groundRatio ?? .88,(data.targetHeightRatio ?? .72)+.01,.99),
      playing: false
    });
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
  function openSettingsDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("sprited-settings", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("settings");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function loadDefaultExportDirectory() {
    if (!("indexedDB" in window)) return updateExportFolderUi();
    try {
      const db = await openSettingsDb();
      defaultExportDirectory = await new Promise((resolve, reject) => {
        const request = db.transaction("settings").objectStore("settings").get("default-export-directory");
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      db.close();
    } catch {
      defaultExportDirectory = null;
    }
    updateExportFolderUi();
  }
  async function storeDefaultExportDirectory(directory) {
    defaultExportDirectory = directory;
    if ("indexedDB" in window) {
      try {
        const db = await openSettingsDb();
        await new Promise((resolve, reject) => {
          const transaction = db.transaction("settings", "readwrite");
          transaction.objectStore("settings").put(directory, "default-export-directory");
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
        });
        db.close();
      } catch {}
    }
    updateExportFolderUi();
  }
  function updateExportFolderUi() {
    const label = $("#exportFolderName"), button = $("#chooseExportFolderBtn");
    if (!label || !button) return;
    if (!window.showDirectoryPicker) {
      label.textContent = "Folder selection is not supported on this system";
      button.disabled = true;
    } else {
      label.textContent = defaultExportDirectory ? defaultExportDirectory.name : "Not selected — exports use Downloads";
      button.disabled = false;
    }
  }
  async function chooseDefaultExportFolder() {
    if (!window.showDirectoryPicker) return null;
    try {
      const directory = await window.showDirectoryPicker({ mode: "readwrite" });
      await storeDefaultExportDirectory(directory);
      toast(`Default export folder: ${directory.name}`, "success");
      return directory;
    } catch {
      return null;
    }
  }
  async function writableDefaultExportDirectory() {
    const directory = defaultExportDirectory;
    if (!directory) return null;
    try {
      if (!directory.queryPermission || await directory.queryPermission({ mode: "readwrite" }) === "granted") return directory;
      if (directory.requestPermission && await directory.requestPermission({ mode: "readwrite" }) === "granted") return directory;
    } catch {}
    toast("Please choose the export folder again", "error");
    return null;
  }
  async function writeDirectoryFile(directory, name, blob) {
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }
  function canvasBlob(c) { return new Promise((resolve) => c.toBlob(resolve, "image/png")); }
  async function alphaBounds(source) {
    const image = typeof source === "string" ? await loadImage(source) : source;
    const c = document.createElement("canvas"); c.width = image.naturalWidth || image.width; c.height = image.naturalHeight || image.height;
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
  function colorHex({ r, g, b }) {
    return `#${[r,g,b].map((v) => clamp(Math.round(v),0,255).toString(16).padStart(2,"0")).join("")}`;
  }
  function sampleBackground(image) {
    const c=document.createElement("canvas"),max=512,ratio=Math.min(max/image.naturalWidth,max/image.naturalHeight,1);
    c.width=Math.max(1,Math.round(image.naturalWidth*ratio));c.height=Math.max(1,Math.round(image.naturalHeight*ratio));
    const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(image,0,0,c.width,c.height);
    const d=x.getImageData(0,0,c.width,c.height).data,samples=[],step=Math.max(1,Math.floor(Math.min(c.width,c.height)/80));
    for(let px=0;px<c.width;px+=step){samples.push(px,(c.height-1)*c.width+px)}
    for(let py=0;py<c.height;py+=step){samples.push(py*c.width,py*c.width+c.width-1)}
    const green=samples.map((p)=>({r:d[p*4],g:d[p*4+1],b:d[p*4+2]})).filter((v)=>v.g>v.r*1.05&&v.g>v.b*1.05);
    const pool=green.length>samples.length*.35?green:samples.map((p)=>({r:d[p*4],g:d[p*4+1],b:d[p*4+2]}));
    const median=(key)=>pool.map((v)=>v[key]).sort((a,b)=>a-b)[Math.floor(pool.length/2)]||0;
    return {r:median("r"),g:median("g"),b:median("b")};
  }
  function isAutoBackground(d,i,key) {
    if(d[i+3]<12)return true;
    const r=d[i],g=d[i+1],b=d[i+2],dr=r-key.r,dg=g-key.g,db=b-key.b;
    const dist=Math.sqrt(dr*dr+dg*dg+db*db),dominance=g-Math.max(r,b),keyIsGreen=key.g>key.r*1.08&&key.g>key.b*1.08;
    return (keyIsGreen&&dist<68)||(g>48&&dominance>18&&g>r*1.1&&g>b*1.1);
  }
  function detectAutoGrid(image,key) {
    const c=document.createElement("canvas"),max=720,ratio=Math.min(max/image.naturalWidth,max/image.naturalHeight,1);
    c.width=Math.max(1,Math.round(image.naturalWidth*ratio));c.height=Math.max(1,Math.round(image.naturalHeight*ratio));
    const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(image,0,0,c.width,c.height);
    const d=x.getImageData(0,0,c.width,c.height).data,w=c.width,h=c.height,integral=new Uint32Array((w+1)*(h+1));
    for(let py=0;py<h;py++){let row=0;for(let px=0;px<w;px++){const fg=isAutoBackground(d,(py*w+px)*4,key)?0:1;row+=fg;integral[(py+1)*(w+1)+px+1]=integral[py*(w+1)+px+1]+row}}
    const area=(x0,y0,x1,y1)=>integral[y1*(w+1)+x1]-integral[y0*(w+1)+x1]-integral[y1*(w+1)+x0]+integral[y0*(w+1)+x0];
    let best={cols:2,rows:4,score:-Infinity};
    for(let rows=1;rows<=8;rows++)for(let cols=1;cols<=8;cols++){
      const count=rows*cols;if(count<2||count>32)continue;
      const cellW=w/cols,cellH=h/rows,aspect=cellW/cellH;if(aspect<.25||aspect>4)continue;
      const occupancies=[];let empty=0;
      for(let r=0;r<rows;r++)for(let col=0;col<cols;col++){
        const x0=Math.round(col*cellW),x1=Math.round((col+1)*cellW),y0=Math.round(r*cellH),y1=Math.round((r+1)*cellH);
        const occ=area(x0,y0,x1,y1)/Math.max(1,(x1-x0)*(y1-y0));occupancies.push(occ);if(occ<.006)empty++;
      }
      let boundary=0,lines=0,strip=2;
      for(let col=1;col<cols;col++){const px=Math.round(col*cellW);boundary+=area(Math.max(0,px-strip),0,Math.min(w,px+strip+1),h)/Math.max(1,(strip*2+1)*h);lines++}
      for(let r=1;r<rows;r++){const py=Math.round(r*cellH);boundary+=area(0,Math.max(0,py-strip),w,Math.min(h,py+strip+1))/Math.max(1,(strip*2+1)*w);lines++}
      boundary=lines?boundary/lines:1;
      const mean=occupancies.reduce((a,b)=>a+b,0)/occupancies.length;
      const spread=Math.sqrt(occupancies.reduce((a,b)=>a+(b-mean)*(b-mean),0)/occupancies.length);
      const common=[8,12,16,6,10].includes(count)?.34:0;
      const score=Math.log(count)*.82-boundary*13-empty*5-spread*1.4-Math.abs(Math.log(aspect))*.09+common;
      if(score>best.score)best={cols,rows,score};
    }
    return best;
  }
  function removeChromaFromCanvas(c,key) {
    const x=c.getContext("2d",{willReadFrequently:true}),id=x.getImageData(0,0,c.width,c.height),d=id.data;
    const keyIsGreen=key.g>key.r*1.08&&key.g>key.b*1.08;
    for(let i=0;i<d.length;i+=4){
      const r=d[i],g=d[i+1],b=d[i+2],dr=r-key.r,dg=g-key.g,db=b-key.b,dist=Math.sqrt(dr*dr+dg*dg+db*db);
      const dominance=g-Math.max(r,b),hueGreen=g>48&&g>r*1.08&&g>b*1.08;
      const keyStrength=keyIsGreen?clamp((76-dist)/34,0,1):0,greenStrength=hueGreen?clamp((dominance-7)/25,0,1):0,strength=Math.max(keyStrength,greenStrength);
      if(strength>.98)d[i+3]=0;
      else if(strength>0){d[i+3]=Math.round(d[i+3]*(1-strength));d[i+1]=Math.round(g-(g-Math.max(r,b))*strength*.8)}
    }
    x.putImageData(id,0,0);
  }
  function analyzeObjects(c) {
    const x=c.getContext("2d",{willReadFrequently:true}),id=x.getImageData(0,0,c.width,c.height),d=id.data,w=c.width,h=c.height;
    const labels=new Int32Array(w*h);labels.fill(-1);const queue=new Int32Array(w*h),parts=[];
    for(let start=0;start<w*h;start++){
      if(labels[start]!==-1||d[start*4+3]<18)continue;
      const label=parts.length;let head=0,tail=0,area=0,minX=w,minY=h,maxX=0,maxY=0,sumX=0,sumY=0,white=0;
      queue[tail++]=start;labels[start]=label;
      while(head<tail){
        const p=queue[head++],px=p%w,py=(p/w)|0,di=p*4;area++;minX=Math.min(minX,px);minY=Math.min(minY,py);maxX=Math.max(maxX,px);maxY=Math.max(maxY,py);sumX+=px;sumY+=py;
        if(d[di]>165&&d[di+1]>165&&d[di+2]>165&&Math.max(d[di],d[di+1],d[di+2])-Math.min(d[di],d[di+1],d[di+2])<65)white++;
        if(px>0&&labels[p-1]===-1&&d[(p-1)*4+3]>=18){labels[p-1]=label;queue[tail++]=p-1}
        if(px<w-1&&labels[p+1]===-1&&d[(p+1)*4+3]>=18){labels[p+1]=label;queue[tail++]=p+1}
        if(py>0&&labels[p-w]===-1&&d[(p-w)*4+3]>=18){labels[p-w]=label;queue[tail++]=p-w}
        if(py<h-1&&labels[p+w]===-1&&d[(p+w)*4+3]>=18){labels[p+w]=label;queue[tail++]=p+w}
        if(px>0&&py>0&&labels[p-w-1]===-1&&d[(p-w-1)*4+3]>=18){labels[p-w-1]=label;queue[tail++]=p-w-1}
        if(px<w-1&&py>0&&labels[p-w+1]===-1&&d[(p-w+1)*4+3]>=18){labels[p-w+1]=label;queue[tail++]=p-w+1}
        if(px>0&&py<h-1&&labels[p+w-1]===-1&&d[(p+w-1)*4+3]>=18){labels[p+w-1]=label;queue[tail++]=p+w-1}
        if(px<w-1&&py<h-1&&labels[p+w+1]===-1&&d[(p+w+1)*4+3]>=18){labels[p+w+1]=label;queue[tail++]=p+w+1}
      }
      parts.push({id:label,area,minX,minY,maxX,maxY,cx:sumX/area,cy:sumY/area,whiteRatio:white/area});
    }
    return{x,id,d,w,h,labels,parts};
  }
  function extractObjectFrames(c,grid) {
    const analysis=analyzeObjects(c),{x,id,d,w,h,labels}=analysis,sorted=[...analysis.parts].sort((a,b)=>b.area-a.area);
    if(!sorted.length)return[];
    const expected=Math.min(grid.cols*grid.rows,32),cellW=w/Math.max(1,grid.cols),cellH=h/Math.max(1,grid.rows);
    const minSeed=Math.max(80,w*h*.00045,sorted[0].area*.012),candidates=sorted.filter((part)=>part.area>=minSeed),seeds=[];
    for(const part of candidates){
      if(seeds.every((seed)=>Math.abs(seed.cx-part.cx)>cellW*.31||Math.abs(seed.cy-part.cy)>cellH*.31))seeds.push(part);
      if(seeds.length===expected)break;
    }
    if(seeds.length<expected)for(const part of candidates){
      if(!seeds.includes(part)&&seeds.every((seed)=>Math.abs(seed.cx-part.cx)>cellW*.15||Math.abs(seed.cy-part.cy)>cellH*.15))seeds.push(part);
      if(seeds.length===expected)break;
    }
    if(!seeds.length)return[];
    const rowOrdered=[...seeds].sort((a,b)=>a.cy-b.cy),ordered=[];
    for(let i=0;i<rowOrdered.length;i+=grid.cols)ordered.push(...rowOrdered.slice(i,i+grid.cols).sort((a,b)=>a.cx-b.cx));
    const groups=ordered.map((seed)=>({seed,parts:[seed]}));let filteredParts=0;
    for(const part of analysis.parts){
      if(ordered.includes(part))continue;
      let best=null,bestDistance=Infinity;
      groups.forEach((group)=>{
        const dx=(part.cx-group.seed.cx)/Math.max(1,cellW),dy=(part.cy-group.seed.cy)/Math.max(1,cellH),distance=Math.sqrt(dx*dx+dy*dy);
        if(distance<bestDistance){bestDistance=distance;best=group}
      });
      if(!best||bestDistance>.78)continue;
      const likelyLabel=part.area<best.seed.area*.09&&part.whiteRatio>.42&&part.cy>best.seed.cy+cellH*.2;
      const gapX=Math.max(0,best.seed.minX-part.maxX,part.minX-best.seed.maxX);
      const gapY=Math.max(0,best.seed.minY-part.maxY,part.minY-best.seed.maxY);
      const edgeDistance=Math.hypot(gapX/Math.max(1,cellW),gapY/Math.max(1,cellH));
      const areaRatio=part.area/Math.max(1,best.seed.area);
      const tiny=part.area<Math.max(14,best.seed.area*.0015);
      const detachedParticle=areaRatio<.018&&edgeDistance>.13;
      const plausiblePart=areaRatio>=.018
        ? edgeDistance<.72
        : areaRatio>=.004
          ? edgeDistance<.18
          : edgeDistance<.045;
      if(!likelyLabel&&!tiny&&!detachedParticle&&plausiblePart)best.parts.push(part);
      else filteredParts++;
    }
    const padding=Math.max(3,Math.round(Math.min(cellW,cellH)*.025)),objects=[];
    for(const group of groups){
      const minX=Math.max(0,Math.min(...group.parts.map((part)=>part.minX))-padding),minY=Math.max(0,Math.min(...group.parts.map((part)=>part.minY))-padding);
      const maxX=Math.min(w-1,Math.max(...group.parts.map((part)=>part.maxX))+padding),maxY=Math.min(h-1,Math.max(...group.parts.map((part)=>part.maxY))+padding);
      const out=document.createElement("canvas");out.width=maxX-minX+1;out.height=maxY-minY+1;const ox=out.getContext("2d"),outId=ox.createImageData(out.width,out.height),allowed=new Uint8Array(analysis.parts.length);
      group.parts.forEach((part)=>allowed[part.id]=1);
      for(let py=minY;py<=maxY;py++)for(let px=minX;px<=maxX;px++){
        const sourcePixel=py*w+px,label=labels[sourcePixel];if(label<0||!allowed[label])continue;
        const si=sourcePixel*4,di=((py-minY)*out.width+(px-minX))*4;outId.data[di]=d[si];outId.data[di+1]=d[si+1];outId.data[di+2]=d[si+2];outId.data[di+3]=d[si+3];
      }
      ox.putImageData(outId,0,0);objects.push(out);
    }
    objects.filteredParts=filteredParts;
    return objects;
  }
  function detectBodyBounds(c) {
    const x=c.getContext("2d",{willReadFrequently:true}),d=x.getImageData(0,0,c.width,c.height).data,w=c.width,h=c.height,labels=new Int32Array(w*h),queue=new Int32Array(w*h),parts=[];
    labels.fill(-1);
    const bodyPixel=(p)=>{const i=p*4,r=d[i],g=d[i+1],b=d[i+2];return d[i+3]>=20&&!(r>125&&r>g*1.3&&r>b*1.16)};
    for(let start=0;start<w*h;start++){
      if(labels[start]!==-1||!bodyPixel(start))continue;
      const label=parts.length;let head=0,tail=0,area=0,minX=w,minY=h,maxX=0,maxY=0;queue[tail++]=start;labels[start]=label;
      while(head<tail){const p=queue[head++],px=p%w,py=(p/w)|0;area++;minX=Math.min(minX,px);minY=Math.min(minY,py);maxX=Math.max(maxX,px);maxY=Math.max(maxY,py);
        if(px>0&&labels[p-1]===-1&&bodyPixel(p-1)){labels[p-1]=label;queue[tail++]=p-1}
        if(px<w-1&&labels[p+1]===-1&&bodyPixel(p+1)){labels[p+1]=label;queue[tail++]=p+1}
        if(py>0&&labels[p-w]===-1&&bodyPixel(p-w)){labels[p-w]=label;queue[tail++]=p-w}
        if(py<h-1&&labels[p+w]===-1&&bodyPixel(p+w)){labels[p+w]=label;queue[tail++]=p+w}
      }
      parts.push({area,minX,minY,maxX,maxY});
    }
    if(!parts.length)return{x:0,y:0,w,h};
    const body=parts.reduce((a,b)=>b.area>a.area?b:a,parts[0]),pad=Math.max(2,Math.round(Math.max(body.maxX-body.minX,body.maxY-body.minY)*.035));
    const minX=Math.max(0,body.minX-pad),minY=Math.max(0,body.minY-pad),maxX=Math.min(w-1,body.maxX+pad),maxY=Math.min(h-1,body.maxY+pad);
    return{x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1};
  }
  async function autoImport(file) {
    if(!file)return;
    try{
      status("Removing background and detecting complete sprite objects…");
      const src=await readDataUrl(file),image=await loadImage(src),key=sampleBackground(image),grid=detectAutoGrid(image,key);
      const full=document.createElement("canvas");full.width=image.naturalWidth;full.height=image.naturalHeight;full.getContext("2d").drawImage(image,0,0);removeChromaFromCanvas(full,key);
      const objects=extractObjectFrames(full,grid);commit();const created=[],base=file.name.replace(/\.[^.]+$/,"");
      for(const object of objects){const bodyBounds=detectBodyBounds(object),frame=await makeFrame(object.toDataURL("image/png"),`${base} ${String(created.length+1).padStart(2,"0")}`);frame.charBounds=bodyBounds;created.push(frame)}
      if(!created.length)throw new Error("No frames detected");
      const requestedBodyHeight=state.canvasHeight*state.targetHeightRatio;
      const safeBodyHeight=Math.min(...created.map((frame)=>Math.min(state.canvasWidth*.9*frame.charBounds.h/Math.max(1,frame.alphaBounds.w),state.canvasHeight*.9*frame.charBounds.h/Math.max(1,frame.alphaBounds.h))));
      const bodyHeight=clamp(Math.min(requestedBodyHeight,safeBodyHeight),state.canvasHeight*.15,state.canvasHeight*.95);state.targetHeightRatio=bodyHeight/state.canvasHeight;state.rulerBottomRatio=clamp(state.rulerBottomRatio,state.targetHeightRatio+.01,.99);
      created.forEach((frame)=>{frame.scale=clamp(bodyHeight/Math.max(1,frame.charBounds.h),.05,10);Object.assign(frame,centerPatch(frame));Object.assign(frame,groundPatch(frame))});
      state.frames.push(...created);state.selectedId=created[0].id;state.selectedIds=[created[0].id];state.selectionAnchorId=created[0].id;state.referenceId ||= created[0].id;
      $("#bgColor").value=colorHex(key);images.clear();syncInputs();renderAll();fitZoom();status("Auto import complete");
      const filteredNote=objects.filteredParts?` · ${objects.filteredParts} loose fragments filtered`:"";
      toast(`Auto Import: ${created.length} complete objects · background removed${filteredNote} · arranged ${grid.cols} × ${grid.rows}`,"success");
    }catch(error){status("Ready");toast("Automatic import could not read this sheet. Try Manual Grid.","error")}
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
      target.setLineDash([]);target.lineWidth=7;target.strokeStyle="#28140d";target.beginPath();target.moveTo(0,y);target.lineTo(state.canvasWidth,y);target.stroke();
      target.lineWidth=3;target.strokeStyle="#78f0b1";target.beginPath();target.moveTo(0,y);target.lineTo(state.canvasWidth,y);target.stroke();
      target.fillStyle="#28140d";target.fillRect(6,y-23,62,17);target.strokeStyle="#78f0b1";target.lineWidth=2;target.strokeRect(6,y-23,62,17);
      target.fillStyle="#a8ffd0";target.font="bold 11px system-ui";target.fillText("GROUND",12,y-10);
    }
    if (state.guides) {
      const ax=state.canvasWidth*state.anchorRatio,groundY=state.canvasHeight*state.groundRatio,rulerBottomY=state.canvasHeight*state.rulerBottomRatio,topY=rulerBottomY-state.canvasHeight*state.targetHeightRatio,rulerX=clamp(ax-34,14,state.canvasWidth-14);
      const rulerPixels=Math.round(state.canvasHeight*state.targetHeightRatio),labelX=clamp(rulerX-34,4,state.canvasWidth-76),labelY=clamp(topY-25,4,state.canvasHeight-23);
      target.setLineDash([10,6]);target.lineWidth=6;target.strokeStyle="#28140d";target.beginPath();target.moveTo(ax,0);target.lineTo(ax,state.canvasHeight);target.stroke();
      target.lineWidth=3;target.strokeStyle="#ffd08a";target.beginPath();target.moveTo(ax,0);target.lineTo(ax,state.canvasHeight);target.stroke();
      target.setLineDash([]);target.lineWidth=6;target.strokeStyle="#28140d";target.beginPath();target.moveTo(rulerX,topY);target.lineTo(rulerX,rulerBottomY);target.moveTo(rulerX-11,topY);target.lineTo(rulerX+11,topY);target.moveTo(rulerX-11,rulerBottomY);target.lineTo(rulerX+11,rulerBottomY);target.stroke();
      target.lineWidth=3;target.strokeStyle="#ffd08a";target.beginPath();target.moveTo(rulerX,topY);target.lineTo(rulerX,rulerBottomY);target.moveTo(rulerX-11,topY);target.lineTo(rulerX+11,topY);target.moveTo(rulerX-11,rulerBottomY);target.lineTo(rulerX+11,rulerBottomY);target.stroke();
      for(let y=topY;y<=rulerBottomY;y+=Math.max(12,state.canvasHeight*.05)){target.lineWidth=3;target.beginPath();target.moveTo(rulerX-5,y);target.lineTo(rulerX+5,y);target.stroke()}
      target.fillStyle="#ffd08a";target.strokeStyle="#28140d";target.lineWidth=3;target.fillRect(rulerX-7,topY-5,14,10);target.strokeRect(rulerX-7,topY-5,14,10);target.fillRect(rulerX-7,rulerBottomY-5,14,10);target.strokeRect(rulerX-7,rulerBottomY-5,14,10);
      target.fillStyle="#28140d";target.fillRect(labelX,labelY,72,19);target.strokeStyle="#ffd08a";target.lineWidth=2;target.strokeRect(labelX,labelY,72,19);
      target.fillStyle="#ffe2ad";target.font="bold 10px system-ui";target.fillText(`${rulerPixels} px`,labelX+10,labelY+13);
      const fenceLeft=Math.max(2,ax-44),fenceRight=Math.min(state.canvasWidth-2,ax+44);
      target.lineWidth=8;target.strokeStyle="#28140d";target.beginPath();target.moveTo(fenceLeft,rulerBottomY);target.lineTo(fenceRight,rulerBottomY);target.moveTo(fenceLeft,rulerBottomY-10);target.lineTo(fenceLeft,rulerBottomY+10);target.moveTo(fenceRight,rulerBottomY-10);target.lineTo(fenceRight,rulerBottomY+10);target.stroke();
      target.lineWidth=4;target.strokeStyle="#ffd08a";target.beginPath();target.moveTo(fenceLeft,rulerBottomY);target.lineTo(fenceRight,rulerBottomY);target.moveTo(fenceLeft,rulerBottomY-10);target.lineTo(fenceLeft,rulerBottomY+10);target.moveTo(fenceRight,rulerBottomY-10);target.lineTo(fenceRight,rulerBottomY+10);target.stroke();
      target.fillStyle="#28140d";target.strokeStyle="#ffd08a";target.lineWidth=3;target.beginPath();target.arc(ax,groundY,9,0,Math.PI*2);target.fill();target.stroke();
      target.fillStyle="#28140d";target.fillRect(ax+12,groundY-25,62,18);target.strokeStyle="#ffd08a";target.lineWidth=2;target.strokeRect(ax+12,groundY-25,62,18);
      target.fillStyle="#ffe2ad";target.font="bold 10px system-ui";target.fillText("ANCHOR",ax+18,groundY-12);
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
      <button class="frame-item ${state.selectedIds.includes(f.id) ? "selected" : ""} ${f.id === state.selectedId ? "active-frame" : ""}" data-id="${f.id}" draggable="true">
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
        const id = el.dataset.id;
        if (event.target.closest(".star")) {
          commit(); state.referenceId = id; state.selectedId = id; state.selectedIds = [id]; state.selectionAnchorId = id;
          renderAll(); return;
        }
        if (event.shiftKey) {
          const anchorId = state.selectionAnchorId || state.selectedId || id;
          const anchorIndex = Math.max(0, state.frames.findIndex((f) => f.id === anchorId));
          const clickedIndex = state.frames.findIndex((f) => f.id === id);
          const start = Math.min(anchorIndex, clickedIndex), end = Math.max(anchorIndex, clickedIndex);
          state.selectedIds = state.frames.slice(start, end + 1).map((f) => f.id);
          state.selectedId = id;
        } else if (event.ctrlKey || event.metaKey) {
          state.selectedIds = state.selectedIds.includes(id)
            ? state.selectedIds.filter((selectedId) => selectedId !== id)
            : [...state.selectedIds, id];
          state.selectedId = state.selectedIds.includes(id)
            ? id
            : (state.selectedIds[state.selectedIds.length - 1] || null);
          state.selectionAnchorId = id;
        } else {
          state.selectedId = id; state.selectedIds = [id]; state.selectionAnchorId = id;
        }
        renderAll();
      };
      el.ondragstart = () => draggedId = el.dataset.id;
      el.ondragover = (event) => event.preventDefault();
      el.ondrop = () => {
        if (!draggedId || draggedId === el.dataset.id) return; commit();
        const from = state.frames.findIndex((f) => f.id === draggedId), to = state.frames.findIndex((f) => f.id === el.dataset.id);
        const [moved] = state.frames.splice(from, 1); state.frames.splice(to, 0, moved); draggedId = null; renderAll();
      };
    });
    $$("#timelineFrames button").forEach((el) => el.onclick = () => {
      state.selectedId = el.dataset.id; state.selectedIds = [el.dataset.id]; state.selectionAnchorId = el.dataset.id; renderAll();
    });
    const selectionCount = state.selectedIds.length;
    $("#deleteBtn").textContent = selectionCount > 1 ? `Delete ${selectionCount} frames` : "Delete frame";
  }
  function renderInspector() {
    const f = selected(), i = state.frames.indexOf(f);
    $("#inspectorEmpty").classList.toggle("hidden", !!f); $("#inspector").classList.toggle("hidden", !f); $("#resetBtn").disabled = !f;
    $("#inspectorTitle").textContent = f
      ? `Frame ${i+1}${state.selectedIds.length > 1 ? ` · ${state.selectedIds.length} selected` : ""}`
      : "No frame selected";
    if (!f) return;
    $("#propX").value = Math.round(f.x*100)/100; $("#propY").value = Math.round(f.y*100)/100;
    $("#propScale").value = Math.round(f.scale*1000)/1000; $("#propRotation").value = f.rotation;
    $("#propScaleRange").value = clamp(Math.round(f.scale*100),5,400); $("#propScaleOutput").textContent = `${Math.round(f.scale*100)}%`;
    $("#boundX").value = Math.round(f.charBounds.x); $("#boundY").value = Math.round(f.charBounds.y);
    $("#boundW").value = Math.round(f.charBounds.w); $("#boundH").value = Math.round(f.charBounds.h);
    $("#durationInput").value = f.duration; $("#matchBtn").disabled = !reference() || reference().id === f.id;
  }
  function exportFrameSize() {
    const value=$("#exportResolution").value;
    if(value==="current")return{w:state.canvasWidth,h:state.canvasHeight,label:"current"};
    const w=clamp(Number(value)||state.canvasWidth,16,4096),h=Math.max(1,Math.round(w*state.canvasHeight/state.canvasWidth));
    return{w,h,label:value};
  }
  function updateExport() {
    const columns = clamp(Number($("#exportColumns").value)||1,1,Math.max(1,state.frames.length)), rows = Math.ceil(state.frames.length/columns);
    const size=exportFrameSize();
    $("#exportSummary").textContent = `${state.frames.length} frames · ${columns} × ${rows} grid`;
    $("#exportDimensions").textContent = state.frames.length ? `${size.w*columns} × ${size.h*rows} px · ${size.w} × ${size.h} per frame · transparent PNG` : "Add frames before exporting";
  }
  function renderAll() { renderFrames(); renderInspector(); renderCanvas(); updateExport(); updateHistory(); }
  function syncInputs() {
    $("#projectName").value = state.projectName; $("#canvasWidth").value = state.canvasWidth; $("#canvasHeight").value = state.canvasHeight;
    $("#groundLine").value = state.groundRatio*100; $("#groundOutput").textContent = `${Math.round(state.groundRatio*100)}%`;
    $("#anchorLine").value = state.anchorRatio*100; $("#anchorOutput").textContent = `${Math.round(state.anchorRatio*100)}%`;
    $("#rulerHeight").value = state.targetHeightRatio*100; $("#rulerOutput").textContent = `${Math.round(state.canvasHeight*state.targetHeightRatio)} px · ${Math.round(state.targetHeightRatio*100)}%`;
    $("#rulerPosition").value = state.rulerBottomRatio*100; $("#rulerPositionOutput").textContent = `${Math.round(state.rulerBottomRatio*100)}%`;
    $("#guidesBtn").classList.toggle("active", state.guides);
    $("#fpsInput").value = state.fps; $("#loopBtn").classList.toggle("active", state.loop);
  }
  async function importFrames(files) {
    const list = [...files].filter((f) => f.type.startsWith("image/")); if (!list.length) return;
    commit(); status(`Importing ${list.length} frames…`); const created = [];
    for (const file of list) created.push(await makeFrame(await readDataUrl(file), file.name.replace(/\.[^.]+$/,"")));
    state.frames.push(...created);
    if (!state.selectedId) {
      state.selectedId = created[0].id; state.selectedIds = [created[0].id]; state.selectionAnchorId = created[0].id;
    }
    state.referenceId ||= created[0].id;
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
    state.frames.push(...created);
    if (!state.selectedId && created[0]) {
      state.selectedId=created[0].id;state.selectedIds=[created[0].id];state.selectionAnchorId=created[0].id;
    }
    state.referenceId ||= created[0]?.id;$("#sliceModal").classList.add("hidden");status("Sprite sheet sliced");renderAll();fitZoom();toast(`${created.length} frames created`,"success");
  }
  function centerPatch(f,target=state.canvasWidth*state.anchorRatio){const b=renderedBounds(f);return{x:f.x+target-(b.x+b.w/2)}}
  function groundPatch(f,target=state.canvasHeight*state.groundRatio){const b=renderedBounds(f);return{y:f.y+target-(b.y+b.h)}}
  function nudgeSelection(key,amount){
    const movement={
      ArrowLeft:{x:-amount,y:0},ArrowRight:{x:amount,y:0},
      ArrowUp:{x:0,y:-amount},ArrowDown:{x:0,y:amount}
    }[key];
    if(!movement)return 0;
    const ids=new Set(state.selectedIds.length?state.selectedIds:[state.selectedId].filter(Boolean));
    let moved=0;
    state.frames.forEach((frame)=>{if(ids.has(frame.id)){frame.x+=movement.x;frame.y+=movement.y;moved++}});
    return moved;
  }
  function match(f,ref){const scaled={...f,scale:ref.charBounds.h*ref.scale/Math.max(1,f.charBounds.h)};const centered={...scaled,...centerPatch(scaled)};const rb=renderedBounds(ref);return{...centered,...groundPatch(centered,rb.y+rb.h)}}
  function normalize() {
    let ref=reference();if(!ref)return toast("Choose a reference frame first","error");commit();ref={...ref,...centerPatch(ref)};ref={...ref,...groundPatch(ref)};
    state.frames=state.frames.map(f=>f.id===ref.id?ref:match(f,ref));renderAll();toast(`Normalized ${state.frames.length} frames`,"success");
  }
  function captureGuides() {
    const f=selected();if(!f)return;commit();const b=renderedBounds(f);
    state.anchorRatio=clamp((b.x+b.w/2)/state.canvasWidth,.05,.95);state.groundRatio=clamp((b.y+b.h)/state.canvasHeight,.5,.98);state.targetHeightRatio=clamp(b.h/state.canvasHeight,.05,.95);state.rulerBottomRatio=clamp((b.y+b.h)/state.canvasHeight,state.targetHeightRatio+.01,.99);
    syncInputs();renderAll();toast("Anchor and ruler read from selected frame","success");
  }
  function alignSelectedToGuides() {
    const f=selected();if(!f)return;commit();Object.assign(f,centerPatch(f));Object.assign(f,groundPatch(f));renderAll();toast("Frame aligned to anchor");
  }
  function fitAllToGuides() {
    if(!state.frames.length)return;commit();const targetHeight=state.canvasHeight*state.targetHeightRatio;
    state.frames.forEach((f)=>{f.scale=clamp(targetHeight/Math.max(1,f.charBounds.h),.05,10);Object.assign(f,centerPatch(f));Object.assign(f,groundPatch(f))});
    renderAll();toast(`Matched ${state.frames.length} frames to ruler + anchor`,"success");
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
  async function enhanceFrames(all) {
    const targets=(all?state.frames:[selected()].filter(Boolean)).filter((f)=>Math.max(f.sourceWidth,f.sourceHeight)<4096);
    if(!targets.length)return toast("These frames are already at the maximum enhancement size","error");
    const mode=$("#enhanceMode").value;commit();status(`Enhancing ${targets.length} frame${targets.length===1?"":"s"}…`);
    for(const f of targets){
      const image=await loadImage(f.src),factor=Math.min(2,4096/Math.max(image.naturalWidth,image.naturalHeight)),w=Math.max(1,Math.round(image.naturalWidth*factor)),h=Math.max(1,Math.round(image.naturalHeight*factor));
      const c=document.createElement("canvas");c.width=w;c.height=h;const x=c.getContext("2d",{willReadFrequently:mode==="anime"});x.imageSmoothingEnabled=mode!=="pixel";x.imageSmoothingQuality="high";x.drawImage(image,0,0,w,h);
      if(mode==="anime"&&w*h<=9000000){
        const id=x.getImageData(0,0,w,h),d=id.data,source=new Uint8ClampedArray(d);
        for(let py=1;py<h-1;py++)for(let px=1;px<w-1;px++){
          const i=(py*w+px)*4;if(source[i+3]<5){d[i+3]=0;continue}
          for(let channel=0;channel<3;channel++){const average=(source[i-4+channel]+source[i+4+channel]+source[i-w*4+channel]+source[i+w*4+channel])/4;d[i+channel]=clamp(Math.round(source[i+channel]*1.14-average*.14),0,255)}
          if(d[i+3]<245&&d[i+1]>Math.max(d[i],d[i+2])*1.08)d[i+1]=Math.max(d[i],d[i+2]);
        }
        x.putImageData(id,0,0);
      }
      f.src=c.toDataURL("image/png");f.sourceWidth=w;f.sourceHeight=h;f.scale/=factor;
      ["charBounds","alphaBounds"].forEach((key)=>{f[key]={x:f[key].x*factor,y:f[key].y*factor,w:f[key].w*factor,h:f[key].h*factor}});
    }
    images.clear();status("Visual enhancement complete");renderAll();toast(`${targets.length} frame${targets.length===1?"":"s"} enhanced in ${mode==="pixel"?"Pixel Art":"Anime Smooth"} mode`,"success");
  }
  function fitFrame(){const f=selected();if(!f)return;commit();const b=f.alphaBounds;f.scale=Math.min(state.canvasWidth*.88/b.w,state.canvasHeight*.88/b.h,1);f.x=0;f.y=0;Object.assign(f,centerPatch(f));Object.assign(f,groundPatch(f));renderAll()}
  function deleteSelection() {
    const ids = state.selectedIds.length
      ? [...state.selectedIds]
      : (state.selectedId ? [state.selectedId] : []);
    if (!ids.length) return;
    commit();
    const selectedSet = new Set(ids);
    const firstIndex = Math.max(0, state.frames.findIndex((f) => selectedSet.has(f.id)));
    state.frames = state.frames.filter((f) => !selectedSet.has(f.id));
    if (selectedSet.has(state.referenceId)) state.referenceId = state.frames[0]?.id || null;
    const next = state.frames[Math.min(firstIndex, state.frames.length - 1)] || null;
    state.selectedId = next?.id || null;
    state.selectedIds = next ? [next.id] : [];
    state.selectionAnchorId = next?.id || null;
    renderAll();
    toast(`${ids.length} frame${ids.length === 1 ? "" : "s"} deleted`, "success");
  }
  function step(dir){if(!state.frames.length)return;const i=Math.max(0,state.frames.findIndex(f=>f.id===state.selectedId)),n=state.loop?(i+dir+state.frames.length)%state.frames.length:clamp(i+dir,0,state.frames.length-1);state.selectedId=state.frames[n].id;renderAll()}
  function stop(){state.playing=false;clearTimeout(playTimer);$("#playBtn").textContent="▶"}
  function play(){if(!state.frames.length)return;state.playing=!state.playing;$("#playBtn").textContent=state.playing?"Ⅱ":"▶";if(state.playing)playStep();else stop()}
  function playStep(){if(!state.playing)return;const f=selected()||state.frames[0];playTimer=setTimeout(()=>{const i=state.frames.indexOf(f);if(!state.loop&&i===state.frames.length-1)return stop();step(1);playStep()},f.duration||1000/state.fps)}
  async function renderedFrame(f,size={w:state.canvasWidth,h:state.canvasHeight}){
    const base=document.createElement("canvas");base.width=state.canvasWidth;base.height=state.canvasHeight;await drawFrame(base.getContext("2d"),f,false);
    if(size.w===state.canvasWidth&&size.h===state.canvasHeight)return base;
    const out=document.createElement("canvas");out.width=size.w;out.height=size.h;const x=out.getContext("2d");x.imageSmoothingEnabled=true;x.imageSmoothingQuality="high";x.drawImage(base,0,0,size.w,size.h);return out;
  }
  function prefix(){return($("#exportPrefix").value||state.projectName||"animation").trim().replace(/[^\w-]+/g,"_").replace(/^_+|_+$/g,"").toLowerCase()||"animation"}
  function metadata(cols,size){return{animation:prefix(),fps:state.fps,loop:state.loop,frame_width:size.w,frame_height:size.h,frames:state.frames.length,horizontal_frames:Math.min(cols,state.frames.length),vertical_frames:Math.ceil(state.frames.length/cols),durations_ms:state.frames.map(f=>f.duration),reference_frame:Math.max(0,state.frames.findIndex(f=>f.id===state.referenceId))}}
  async function exportSheet(){
    if(!state.frames.length)return;
    const cols=clamp(Number($("#exportColumns").value)||1,1,state.frames.length),rows=Math.ceil(state.frames.length/cols),size=exportFrameSize(),c=document.createElement("canvas");
    c.width=size.w*cols;c.height=size.h*rows;
    const x=c.getContext("2d");x.imageSmoothingEnabled=true;x.imageSmoothingQuality="high";status("Rendering high-quality sprite sheet…");
    for(let i=0;i<state.frames.length;i++)x.drawImage(await renderedFrame(state.frames[i],size),i%cols*size.w,Math.floor(i/cols)*size.h);
    const sheetBlob=await canvasBlob(c),sheetName=`${prefix()}_${size.w}px_${cols}x${rows}.png`,jsonBlob=new Blob([JSON.stringify(metadata(cols,size),null,2)],{type:"application/json"}),jsonName=`${prefix()}.json`,dir=await writableDefaultExportDirectory();
    if(dir){await writeDirectoryFile(dir,sheetName,sheetBlob);await writeDirectoryFile(dir,jsonName,jsonBlob)}else{download(sheetBlob,sheetName);download(jsonBlob,jsonName)}
    $("#exportModal").classList.add("hidden");status("Sprite sheet exported");toast(`Exported ${c.width} × ${c.height} sprite sheet`,"success");
  }
  async function exportFrames(){
    if(!state.frames.length)return;
    const size=exportFrameSize();
    let dir=await writableDefaultExportDirectory();
    if(!dir&&window.showDirectoryPicker)dir=await chooseDefaultExportFolder();
    if(window.showDirectoryPicker&&!dir)return;
    for(let i=0;i<state.frames.length;i++){
      const blob=await canvasBlob(await renderedFrame(state.frames[i],size)),name=`${prefix()}_${size.w}px_${String(i+1).padStart(3,"0")}.png`;
      if(dir)await writeDirectoryFile(dir,name,blob);else{download(blob,name);await new Promise(r=>setTimeout(r,80))}
    }
    const jsonBlob=new Blob([JSON.stringify(metadata($("#exportColumns").value,size),null,2)],{type:"application/json"}),jsonName=`${prefix()}.json`;
    if(dir)await writeDirectoryFile(dir,jsonName,jsonBlob);else download(jsonBlob,jsonName);
    toast(`${state.frames.length} frames exported at ${size.w} × ${size.h}`,"success");$("#exportModal").classList.add("hidden");
  }
  function saveProject(){state.projectName=$("#projectName").value.trim()||"Untitled Animation";download(new Blob([JSON.stringify(snapshot())],{type:"application/json"}),`${state.projectName.replace(/[^\w-]+/g,"_").toLowerCase()}.spriteproject`);$("#saveState").textContent="Saved locally";toast("Project saved","success")}
  async function openProject(file){try{const data=JSON.parse(await file.text());if(!Array.isArray(data.frames))throw Error();state.history=[];state.future=[];restore(data);$("#saveState").textContent="Saved locally";toast("Project opened","success")}catch{toast("Could not open this project","error")}}
  function setEditorZoom(nextZoom, anchorEvent) {
    const stage=$("#canvasStage"),previous=state.zoom,rect=stage.getBoundingClientRect();
    const localX=anchorEvent?anchorEvent.clientX-rect.left:rect.width/2;
    const localY=anchorEvent?anchorEvent.clientY-rect.top:rect.height/2;
    const contentX=stage.scrollLeft+localX,contentY=stage.scrollTop+localY;
    state.zoom=clamp(nextZoom,.1,4);
    if(state.zoom===previous)return;
    renderCanvas();
    if(anchorEvent){
      const ratio=state.zoom/previous;
      requestAnimationFrame(()=>{
        stage.scrollLeft=contentX*ratio-localX;
        stage.scrollTop=contentY*ratio-localY;
      });
    }
  }
  function fitZoom(){const r=$("#canvasStage").getBoundingClientRect();state.zoom=clamp(Math.min((r.width-90)/state.canvasWidth,(r.height-90)/state.canvasHeight),.1,2);renderCanvas()}
  function bindNumber(id,cb){$(id).onchange=e=>{const v=Number(e.target.value);if(Number.isFinite(v))cb(v)}}
  function bind() {
    $("#autoBtn").onclick=$("#emptyAutoBtn").onclick=()=>$("#autoInput").click();
    $("#sheetBtn").onclick=$("#emptySheetBtn").onclick=()=>$("#sheetInput").click();
    $("#framesBtn").onclick=$("#emptyFramesBtn").onclick=$("#addFramesBtn").onclick=()=>$("#framesInput").click();
    $("#autoInput").onchange=e=>{autoImport(e.target.files[0]);e.target.value=""};
    $("#sheetInput").onchange=e=>{openSlicer(e.target.files[0]);e.target.value=""};$("#framesInput").onchange=e=>{importFrames(e.target.files);e.target.value=""};
    $("#openBtn").onclick=()=>$("#projectInput").click();$("#projectInput").onchange=e=>{if(e.target.files[0])openProject(e.target.files[0]);e.target.value=""};
    $("#saveBtn").onclick=saveProject;$("#newBtn").onclick=()=>{if(state.frames.length&&!confirm("Start a new project? Unsaved work will be cleared."))return;restore({version:1,projectName:"Untitled Animation",frames:[],selectedId:null,referenceId:null,canvasWidth:512,canvasHeight:512,groundRatio:.88,anchorRatio:.5,targetHeightRatio:.72,rulerBottomRatio:.88,fps:12,loop:true});state.history=[];state.future=[]};
    $("#undoBtn").onclick=undo;$("#redoBtn").onclick=redo;
    $("#exportBtn").onclick=()=>{$("#exportPrefix").value=state.projectName==="Untitled Animation"?"animation":state.projectName;updateExport();updateExportFolderUi();$("#exportModal").classList.remove("hidden")};
    $("#firstBtn").onclick=()=>{if(state.frames[0]){state.selectedId=state.frames[0].id;state.selectedIds=[state.frames[0].id];state.selectionAnchorId=state.frames[0].id;renderAll()}};$("#reverseBtn").onclick=()=>{if(state.frames.length>1){commit();state.frames.reverse();renderAll()}};
    $("#duplicateBtn").onclick=()=>{const f=selected();if(!f)return;commit();const copy={...f,id:uid(),name:`${f.name} copy`,charBounds:{...f.charBounds},alphaBounds:{...f.alphaBounds}},i=state.frames.indexOf(f);state.frames.splice(i+1,0,copy);state.selectedId=copy.id;renderAll()};
    $("#deleteBtn").onclick=deleteSelection;
    bindNumber("#propX",v=>{const f=selected();commit();f.x=v;renderAll()});bindNumber("#propY",v=>{const f=selected();commit();f.y=v;renderAll()});bindNumber("#propScale",v=>{const f=selected();commit();f.scale=clamp(v,.05,10);renderAll()});bindNumber("#propRotation",v=>{const f=selected();commit();f.rotation=v;renderAll()});
    $("#propScaleRange").onpointerdown=()=>{if(selected())commit()};$("#propScaleRange").onkeydown=e=>{if(["ArrowLeft","ArrowRight","Home","End","PageUp","PageDown"].includes(e.key)&&selected())commit()};$("#propScaleRange").oninput=e=>{const f=selected();if(!f)return;f.scale=clamp(Number(e.target.value)/100,.05,4);$("#propScale").value=Math.round(f.scale*1000)/1000;$("#propScaleOutput").textContent=`${Math.round(f.scale*100)}%`;renderCanvas()};
    $("#scaleDownBtn").onclick=()=>{const f=selected();if(!f)return;commit();f.scale=clamp(f.scale*.9,.05,10);renderAll()};$("#scaleResetBtn").onclick=()=>{const f=selected();if(!f)return;commit();f.scale=1;renderAll()};$("#scaleUpBtn").onclick=()=>{const f=selected();if(!f)return;commit();f.scale=clamp(f.scale*1.1,.05,10);renderAll()};
    [["#boundX","x"],["#boundY","y"],["#boundW","w"],["#boundH","h"]].forEach(([id,key])=>bindNumber(id,v=>{const f=selected();commit();f.charBounds[key]=["w","h"].includes(key)?Math.max(1,v):v;renderAll()}));
    bindNumber("#durationInput",v=>{const f=selected();commit();f.duration=Math.max(10,v);renderAll()});
    $("#centerBtn").onclick=()=>{const f=selected();commit();Object.assign(f,centerPatch(f));renderAll()};$("#alignBtn").onclick=()=>{const f=selected();commit();Object.assign(f,groundPatch(f));renderAll()};
    $("#detectBtn").onclick=detectBounds;$("#referenceBtn").onclick=()=>{const f=selected();commit();state.referenceId=f.id;renderAll()};$("#matchBtn").onclick=()=>{const f=selected(),r=reference();if(!f||!r)return;commit();Object.assign(f,match(f,r));renderAll()};
    $("#trimBtn").onclick=trim;$("#fitFrameBtn").onclick=fitFrame;$("#normalizeBtn").onclick=normalize;$("#resetBtn").onclick=()=>{const f=selected();if(!f)return;commit();Object.assign(f,{x:0,y:0,scale:1,rotation:0,charBounds:{...f.alphaBounds}});renderAll()};
    bindNumber("#canvasWidth",v=>{commit();state.canvasWidth=clamp(v,16,4096);renderAll();fitZoom()});bindNumber("#canvasHeight",v=>{commit();state.canvasHeight=clamp(v,16,4096);renderAll();fitZoom()});
    ["#groundLine","#anchorLine","#rulerHeight","#rulerPosition"].forEach((id)=>{$(id).onpointerdown=()=>commit();$(id).onkeydown=e=>{if(["ArrowLeft","ArrowRight","Home","End","PageUp","PageDown"].includes(e.key))commit()}});
    $("#groundLine").oninput=e=>{state.groundRatio=Number(e.target.value)/100;$("#groundOutput").textContent=`${e.target.value}%`;renderCanvas()};
    $("#anchorLine").oninput=e=>{state.anchorRatio=Number(e.target.value)/100;$("#anchorOutput").textContent=`${e.target.value}%`;renderCanvas()};
    $("#rulerHeight").oninput=e=>{state.targetHeightRatio=clamp(Number(e.target.value)/100,.05,state.rulerBottomRatio-.01);$("#rulerHeight").value=state.targetHeightRatio*100;$("#rulerOutput").textContent=`${Math.round(state.canvasHeight*state.targetHeightRatio)} px · ${Math.round(state.targetHeightRatio*100)}%`;renderCanvas()};
    $("#rulerPosition").oninput=e=>{state.rulerBottomRatio=clamp(Number(e.target.value)/100,state.targetHeightRatio+.01,.99);$("#rulerPosition").value=state.rulerBottomRatio*100;$("#rulerPositionOutput").textContent=`${Math.round(state.rulerBottomRatio*100)}%`;renderCanvas()};
    $("#captureGuideBtn").onclick=captureGuides;$("#alignGuideBtn").onclick=alignSelectedToGuides;$("#fitAllGuideBtn").onclick=fitAllToGuides;
    $("#softness").oninput=e=>$("#softOutput").textContent=e.target.value;$("#removeBgBtn").onclick=()=>removeBackground(false);$("#removeBgAllBtn").onclick=()=>removeBackground(true);
    $("#enhanceBtn").onclick=()=>enhanceFrames(false);$("#enhanceAllBtn").onclick=()=>enhanceFrames(true);
    bindNumber("#fpsInput",v=>{commit();state.fps=clamp(v,1,60);state.frames.forEach(f=>f.duration=Math.round(1000/state.fps));renderAll()});$("#loopBtn").onclick=()=>{state.loop=!state.loop;$("#loopBtn").classList.toggle("active",state.loop)};
    $("#previousBtn").onclick=()=>step(-1);$("#nextBtn").onclick=()=>step(1);$("#playBtn").onclick=play;
    $("#gridBtn").onclick=()=>{state.grid=!state.grid;$("#gridBtn").classList.toggle("active",state.grid);renderCanvas()};$("#groundBtn").onclick=()=>{state.ground=!state.ground;$("#groundBtn").classList.toggle("active",state.ground);renderCanvas()};$("#guidesBtn").onclick=()=>{state.guides=!state.guides;$("#guidesBtn").classList.toggle("active",state.guides);renderCanvas()};$("#boundsBtn").onclick=()=>{state.bounds=!state.bounds;$("#boundsBtn").classList.toggle("active",state.bounds);renderCanvas()};
    $$("[data-tool]").forEach(b=>b.onclick=()=>{state.tool=b.dataset.tool;canvas.style.cursor=state.tool==="guides"?"crosshair":"grab";$$("[data-tool]").forEach(x=>x.classList.toggle("active",x===b))});
    $("#zoomInBtn").onclick=()=>setEditorZoom(state.zoom+.1);$("#zoomOutBtn").onclick=()=>setEditorZoom(state.zoom-.1);$("#fitBtn").onclick=fitZoom;
    $("#canvasStage").addEventListener("wheel",event=>{
      if(keysDown.has("s")&&!event.ctrlKey&&!event.metaKey&&state.frames.length){
        const ids=new Set(state.selectedIds.length?state.selectedIds:[state.selectedId].filter(Boolean));
        if(!ids.size)return;
        event.preventDefault();
        if(!scaleWheelHistoryOpen){commit();scaleWheelHistoryOpen=true}
        const factor=event.deltaY<0?1.05:1/1.05;
        state.frames.forEach((frame)=>{if(ids.has(frame.id))frame.scale=clamp(frame.scale*factor,.05,10)});
        const active=selected();renderAll();status(`Scale ${Math.round((active?.scale||1)*100)}%`);
        clearTimeout(scaleWheelTimer);scaleWheelTimer=setTimeout(()=>{scaleWheelHistoryOpen=false},280);
        return;
      }
      if(!event.ctrlKey||!state.frames.length)return;
      event.preventDefault();
      const factor=event.deltaY<0?1.1:1/1.1;
      setEditorZoom(Number((state.zoom*factor).toFixed(3)),event);
      status(`Zoom ${Math.round(state.zoom*100)}%`);
    },{passive:false});
    ["#sliceCols","#sliceRows","#sliceGapX","#sliceGapY","#sliceMarginX","#sliceMarginY"].forEach(id=>$(id).oninput=renderSlice);$("#confirmSliceBtn").onclick=confirmSlice;
    $$("[data-close]").forEach(b=>b.onclick=()=>$("#"+b.dataset.close).classList.add("hidden"));$("#exportColumns").oninput=updateExport;$("#exportResolution").onchange=updateExport;$("#chooseExportFolderBtn").onclick=chooseDefaultExportFolder;$("#exportSheetBtn").onclick=exportSheet;$("#exportFramesBtn").onclick=exportFrames;
    $$(".section-title").forEach(b=>b.onclick=()=>{const body=b.nextElementSibling;body.classList.toggle("hidden");b.lastElementChild.textContent=body.classList.contains("hidden")?"⌄":"⌃"});
    $("#projectName").oninput=e=>{state.projectName=e.target.value;$("#saveState").textContent="Unsaved changes"};
    canvas.onpointerdown=e=>{
      if(e.button===1){
        e.preventDefault();
        canvas.focus({preventScroll:true});
        const stage=$("#canvasStage");
        pointerDrag={kind:"pan",clientX:e.clientX,clientY:e.clientY,scrollLeft:stage.scrollLeft,scrollTop:stage.scrollTop};
        stage.classList.add("panning");
        canvas.setPointerCapture(e.pointerId);
        status("Panning view");
        return;
      }
      if(e.button!==0)return;
      const r=canvas.getBoundingClientRect(),p={x:(e.clientX-r.left)/r.width*state.canvasWidth,y:(e.clientY-r.top)/r.height*state.canvasHeight};
      if(state.tool==="guides"){
        commit();
        const rulerX=clamp(state.canvasWidth*state.anchorRatio-34,14,state.canvasWidth-14),rulerBottomY=state.canvasHeight*state.rulerBottomRatio,topY=rulerBottomY-state.canvasHeight*state.targetHeightRatio;
        if(Math.abs(p.x-rulerX)<=20&&p.y>=topY-18&&p.y<=rulerBottomY+18){
          const kind=Math.abs(p.y-topY)<=14?"rulerTop":Math.abs(p.y-rulerBottomY)<=14?"rulerBottom":"rulerMove";
          pointerDrag={kind,p,startBottom:state.rulerBottomRatio,startHeight:state.targetHeightRatio};
        }else{
          pointerDrag={kind:"guides"};state.anchorRatio=clamp(p.x/state.canvasWidth,.05,.95);state.groundRatio=clamp(p.y/state.canvasHeight,.5,.98);
        }
        syncInputs();renderCanvas();canvas.setPointerCapture(e.pointerId);return;
      }
      const f=selected();if(!f)return;commit();pointerDrag={kind:state.tool,p,x:f.x,y:f.y,b:{...f.charBounds}};canvas.setPointerCapture(e.pointerId);
    };
    canvas.onpointermove=e=>{
      if(!pointerDrag)return;
      if(pointerDrag.kind==="pan"){
        const stage=$("#canvasStage");
        stage.scrollLeft=pointerDrag.scrollLeft-(e.clientX-pointerDrag.clientX);
        stage.scrollTop=pointerDrag.scrollTop-(e.clientY-pointerDrag.clientY);
        return;
      }
      const r=canvas.getBoundingClientRect(),p={x:(e.clientX-r.left)/r.width*state.canvasWidth,y:(e.clientY-r.top)/r.height*state.canvasHeight};
      if(pointerDrag.kind==="guides"){
        state.anchorRatio=clamp(p.x/state.canvasWidth,.05,.95);state.groundRatio=clamp(p.y/state.canvasHeight,.5,.98);syncInputs();renderCanvas();return;
      }
      if(["rulerTop","rulerBottom","rulerMove"].includes(pointerDrag.kind)){
        if(pointerDrag.kind==="rulerTop"){
          state.targetHeightRatio=clamp(state.rulerBottomRatio-p.y/state.canvasHeight,.05,state.rulerBottomRatio-.01);
        }else if(pointerDrag.kind==="rulerBottom"){
          const fixedTop=pointerDrag.startBottom-pointerDrag.startHeight;
          state.rulerBottomRatio=clamp(p.y/state.canvasHeight,fixedTop+.05,.99);
          state.targetHeightRatio=state.rulerBottomRatio-fixedTop;
        }else{
          const delta=(p.y-pointerDrag.p.y)/state.canvasHeight;
          state.rulerBottomRatio=clamp(pointerDrag.startBottom+delta,state.targetHeightRatio+.01,.99);
        }
        syncInputs();renderCanvas();status(`Scale ruler ${Math.round(state.canvasHeight*state.targetHeightRatio)} px`);return;
      }
      const f=selected();if(!f)return;const dx=p.x-pointerDrag.p.x,dy=p.y-pointerDrag.p.y;
      if(pointerDrag.kind==="move"){f.x=pointerDrag.x+dx;f.y=pointerDrag.y+dy}else{f.charBounds.x=pointerDrag.b.x+dx/f.scale;f.charBounds.y=pointerDrag.b.y+dy/f.scale}
      renderInspector();renderCanvas();
    };
    canvas.onpointerup=()=>{
      if(pointerDrag&&["rulerTop","rulerBottom","rulerMove"].includes(pointerDrag.kind))toast(`Scale ruler: ${Math.round(state.canvasHeight*state.targetHeightRatio)} px`,"success");
      if(pointerDrag?.kind==="pan")status("View moved");
      $("#canvasStage").classList.remove("panning");
      pointerDrag=null;
    };
    canvas.onpointercancel=()=>{$("#canvasStage").classList.remove("panning");pointerDrag=null};
    canvas.onauxclick=e=>{if(e.button===1)e.preventDefault()};
    window.ondragover=e=>e.preventDefault();window.ondrop=e=>{e.preventDefault();const fs=[...e.dataTransfer.files].filter(f=>f.type.startsWith("image/"));if(fs.length===1)autoImport(fs[0]);else importFrames(fs)};
    window.onkeydown=e=>{
      const typing=["INPUT","TEXTAREA"].includes(document.activeElement?.tagName);
      const modalOpen = Boolean(document.querySelector(".modal-backdrop:not(.hidden)"));
      if(!typing)keysDown.add(e.key.toLowerCase());
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();e.shiftKey?redo():undo()}
      else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();redo()}
      else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();saveProject()}
      else if(!typing&&!modalOpen&&e.key==="Delete"){e.preventDefault();deleteSelection()}
      else if(!typing&&e.code==="Space"){e.preventDefault();play()}
      else if(!typing&&!modalOpen&&e.altKey&&e.key==="ArrowRight"){e.preventDefault();step(1)}
      else if(!typing&&!modalOpen&&e.altKey&&e.key==="ArrowLeft"){e.preventDefault();step(-1)}
      else if(!typing&&!modalOpen&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)){
        e.preventDefault();if(!e.repeat)commit();const amount=e.shiftKey?10:1,moved=nudgeSelection(e.key,amount);
        if(moved){$("#saveState").textContent="Unsaved changes";renderAll();status(`Moved ${moved===1?"frame":`${moved} frames`} ${amount}px`)}
      }
    };
    window.onkeyup=e=>keysDown.delete(e.key.toLowerCase());
    window.addEventListener("blur",()=>{keysDown.clear();scaleWheelHistoryOpen=false;clearTimeout(scaleWheelTimer)});
    const restoreEditorFocus=()=>{
      if(document.visibilityState!=="visible"||document.querySelector(".modal-backdrop:not(.hidden)"))return;
      requestAnimationFrame(()=>canvas.focus({preventScroll:true}));
    };
    window.addEventListener("focus",restoreEditorFocus);
    document.addEventListener("visibilitychange",restoreEditorFocus);
  }
  bind(); loadDefaultExportDirectory(); syncInputs(); renderAll();
})();
