import {validateMotionProgression} from './pose-planner.mjs';
const median=values=>{if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
const adaptive=(values,floor)=>{const m=median(values),mad=median(values.map(value=>Math.abs(value-m)));return m+Math.max(floor,4*mad);};
const round=value=>Math.round(value*10000)/10000;
const color=value=>{const match=/^#([0-9a-f]{6})$/i.exec(value||'');return match?[parseInt(match[1].slice(0,2),16),parseInt(match[1].slice(2,4),16),parseInt(match[1].slice(4,6),16)]:null;};

function analyzeFrame(frame,background){
  const rgba=frame.rgba,bg=color(background),grid=[],size=16,pixelWidth=frame.pixel_width||frame.width,pixelHeight=frame.pixel_height||frame.height;let minX=pixelWidth,minY=pixelHeight,maxX=-1,maxY=-1,count=0,sumX=0,sumY=0;
  const visible=(offset)=>rgba[offset+3]>16&&(!bg||Math.hypot(rgba[offset]-bg[0],rgba[offset+1]-bg[1],rgba[offset+2]-bg[2])>45);
  for(let y=0;y<pixelHeight;y++)for(let x=0;x<pixelWidth;x++){const offset=(y*pixelWidth+x)*4;if(visible(offset)){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);sumX+=x;sumY+=y;count++;}}
  for(let gy=0;gy<size;gy++)for(let gx=0;gx<size;gx++){const x=Math.min(pixelWidth-1,Math.floor((gx+.5)*pixelWidth/size)),y=Math.min(pixelHeight-1,Math.floor((gy+.5)*pixelHeight/size)),offset=(y*pixelWidth+x)*4;if(visible(offset))grid.push(rgba[offset],rgba[offset+1],rgba[offset+2],rgba[offset+3]);else grid.push(0,0,0,0);}
  return {...frame,signature:grid,content:count?{center_x:sumX/count/pixelWidth,center_y:sumY/count/pixelHeight,width:(maxX-minX+1)/pixelWidth,height:(maxY-minY+1)/pixelHeight,area:(maxX-minX+1)*(maxY-minY+1)/(pixelWidth*pixelHeight)}:null};
}
const difference=(a,b)=>a.signature.reduce((sum,value,index)=>sum+Math.abs(value-b.signature[index]),0)/(a.signature.length*255);
const centers=(a,b)=>a.content&&b.content?{x:b.content.center_x-a.content.center_x,y:b.content.center_y-a.content.center_y,distance:Math.hypot(b.content.center_x-a.content.center_x,b.content.center_y-a.content.center_y)}:null;
const scale=(a,b)=>a.content&&b.content&&a.content.area&&b.content.area?Math.abs(Math.log(b.content.area/a.content.area)):null;
const severity=(value,threshold)=>value>threshold*1.6?'high':'medium';

export function validateAnimation(input,{background='#00ff00',loop=true,pose_plan=null,motion_observations={}}={}){
  const issues=[],indexes=input.map(frame=>frame.frame_index),unique=new Set(indexes),sorted=[...input].sort((a,b)=>a.frame_index-b.frame_index),expected=Array.from({length:sorted.length},(_,i)=>i);
  if(input.length<2)issues.push({type:'frame_count',severity:'high',value:input.length});
  if(unique.size!==indexes.length)issues.push({type:'duplicate_frame_index',severity:'high'});
  if(indexes.length&&!expected.every((value,index)=>sorted[index]?.frame_index===value))issues.push({type:'missing_frame_index',severity:'high',expected,actual:sorted.map(frame=>frame.frame_index)});
  const first=sorted[0];for(const frame of sorted){if(!['png','webp'].includes(frame.format)||!frame.rgba)issues.push({type:'invalid_format',frame:frame.frame_index,severity:'high'});if(first&&(frame.width!==first.width||frame.height!==first.height))issues.push({type:'dimension_mismatch',frame:frame.frame_index,severity:'high',width:frame.width,height:frame.height});}
  const valid=sorted.filter(frame=>frame.rgba&&frame.width>0&&frame.height>0).map(frame=>analyzeFrame(frame,background)),pairs=[];
  for(let i=1;i<valid.length;i++){const a=valid[i-1],b=valid[i];pairs.push({a,b,diff:difference(a,b),center:centers(a,b),scale:scale(a,b)});}
  const diffs=pairs.map(pair=>pair.diff),centerSteps=pairs.flatMap(pair=>pair.center?[pair.center.distance]:[]),scaleSteps=pairs.flatMap(pair=>pair.scale==null?[]:[pair.scale]),jumpLimit=adaptive(diffs,.18),centerLimit=adaptive(centerSteps,.08),scaleLimit=adaptive(scaleSteps,.18),duplicateLimit=Math.max(.008,median(diffs)*.12);
  for(const pair of pairs){if(pair.diff<=duplicateLimit)issues.push({type:pair.diff===0?'duplicate':'near_duplicate',frames:[pair.a.frame_index,pair.b.frame_index],frame:pair.b.frame_index,severity:'medium',value:round(1-pair.diff)});if(pair.diff>jumpLimit)issues.push({type:'visual_jump',frames:[pair.a.frame_index,pair.b.frame_index],frame:pair.b.frame_index,severity:severity(pair.diff,jumpLimit),value:round(pair.diff)});if(pair.center&&pair.center.distance>centerLimit)issues.push({type:'center_drift',frame:pair.b.frame_index,severity:severity(pair.center.distance,centerLimit),offset_x:round(pair.center.x),offset_y:round(pair.center.y)});if(pair.scale!=null&&pair.scale>scaleLimit)issues.push({type:'scale_drift',frame:pair.b.frame_index,severity:severity(pair.scale,scaleLimit),value:round(pair.scale)});}
  const loopValidation=validateLoopFromAnalysis(valid,{diffs,centerSteps,scaleSteps,enabled:loop});if(loop&& !loopValidation.passed)for(const issue of loopValidation.issues)issues.push({...issue,frame:loopValidation.last_frame_index,loop:true});
  const penalty={high:20,medium:10,low:5},score=Math.max(0,100-issues.reduce((sum,issue)=>sum+(penalty[issue.severity]||5),0));
  const ranked=new Map();for(const issue of issues){const targets=issue.frame!=null?[issue.frame]:issue.frames?.slice(-1)||[];for(const index of targets){const item=ranked.get(index)||{frame_index:index,reasons:[],priority:0};if(!item.reasons.includes(issue.type))item.reasons.push(issue.type);item.priority+=penalty[issue.severity]||5;ranked.set(index,item);}}
  const bad_frames=[...ranked.values()].sort((a,b)=>b.priority-a.priority||a.frame_index-b.frame_index).slice(0,Math.max(1,Math.floor(sorted.length/2))).map(({priority,...item})=>item);
  const motion_progression_diagnostics=pose_plan?validateMotionProgression(pose_plan,motion_observations):[];for(const diagnostic of motion_progression_diagnostics)if(!diagnostic.natural_transition)issues.push({type:diagnostic.broken_loop?'broken_loop_transition':diagnostic.duplicate_mechanical_pose?'duplicate_mechanical_pose':diagnostic.skipped_phase?'skipped_phase':'motion_progression',frame_index:diagnostic.frame_index,severity:'high'});
  return {animation_id:first?.animation_id||null,passed:issues.length===0,score,frame_count:input.length,issues,bad_frames,loop_validation:loopValidation,confidence:.8,confidence_label:'medium',phase_accuracy:null,phase_accuracy_confidence:.1,pose_plan_version:pose_plan?.version??null,motion_progression_diagnostics,paired_frame_diagnostics:[],metric_notes:'Deterministic pixel, bounds and ordering checks plus optional motion-blueprint progression checks.'};
}

function validateLoopFromAnalysis(frames,{diffs=[],centerSteps=[],scaleSteps=[],enabled=true}={}){
  const first=frames[0],last=frames.at(-1),issues=[];if(!first||!last)return {passed:false,loop_score:0,issues:[{type:'frame_count',severity:'high'}],last_frame_index:last?.frame_index??null,first_frame_index:first?.frame_index??null};
  if(first.width!==last.width||first.height!==last.height)issues.push({type:'loop_dimension_mismatch',severity:'high'});
  const diff=difference(last,first),center=centers(last,first),scaleJump=scale(last,first),diffLimit=adaptive(diffs,.12),centerLimit=adaptive(centerSteps,.08),scaleLimit=adaptive(scaleSteps,.18);
  if(enabled&&diff>diffLimit)issues.push({type:'loop_visual_jump',severity:severity(diff,diffLimit),value:round(diff)});if(enabled&&center&&center.distance>centerLimit)issues.push({type:'loop_center_jump',severity:severity(center.distance,centerLimit),offset_x:round(center.x),offset_y:round(center.y)});if(enabled&&scaleJump!=null&&scaleJump>scaleLimit)issues.push({type:'loop_scale_jump',severity:severity(scaleJump,scaleLimit),value:round(scaleJump)});
  return {passed:issues.length===0,loop_score:Math.max(0,100-issues.reduce((sum,issue)=>sum+(issue.severity==='high'?35:20),0)),issues,last_frame_index:last.frame_index,first_frame_index:first.frame_index,image_difference:round(diff)};
}

export function detectBadFrames(validation){return {animation_id:validation.animation_id,bad_frames:validation.bad_frames};}
export function validateLoop(input,options={}){const validation=validateAnimation(input,options);return {animation_id:validation.animation_id,...validation.loop_validation};}
