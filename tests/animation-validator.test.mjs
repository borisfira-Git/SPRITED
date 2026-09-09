import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAnimation,detectBadFrames,validateLoop} from '../automation/animation-validator.mjs';
import {encodeGif} from '../automation/gif-encoder.mjs';

function frame(frame_index,{width=32,height=32,x=8,y=8,size=10,color=[220,70,40]}={}){const rgba=new Uint8Array(width*height*4);for(let py=y;py<Math.min(height,y+size);py++)for(let px=x;px<Math.min(width,x+size);px++){const offset=(py*width+px)*4;rgba.set([...color,255],offset);}return {frame_id:'f'+frame_index,animation_id:'test-animation',frame_index,format:'png',width,height,rgba};}
const valid=()=>[8,10,12,14,16,14,12,10].map((x,index)=>frame(index,{x,y:8+(index%2)}));

test('valid 8-frame animation',()=>{const result=validateAnimation(valid());assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.score,100);});
test('duplicate frame',()=>{const frames=valid();frames[4]=structuredClone(frames[3]);frames[4].frame_id='f4';frames[4].frame_index=4;const result=validateAnimation(frames);assert.ok(result.issues.some(issue=>issue.type==='duplicate'));assert.ok(detectBadFrames(result).bad_frames.some(frame=>frame.frame_index===4));});
test('dimension mismatch',()=>{const frames=valid();frames[3]=frame(3,{width:40});assert.ok(validateAnimation(frames).issues.some(issue=>issue.type==='dimension_mismatch'&&issue.frame===3));});
test('missing frame index',()=>{const frames=valid();frames.splice(3,1);assert.ok(validateAnimation(frames).issues.some(issue=>issue.type==='missing_frame_index'));});
test('center-position jump',()=>{const frames=valid();frames[4]=frame(4,{x:21});assert.ok(validateAnimation(frames).issues.some(issue=>issue.type==='center_drift'&&issue.frame===4));});
test('scale jump',()=>{const frames=valid();frames[4]=frame(4,{x:4,y:4,size:24});assert.ok(validateAnimation(frames).issues.some(issue=>issue.type==='scale_drift'&&issue.frame===4));});
test('bad last-to-first loop',()=>{const frames=valid();frames[7]=frame(7,{x:21});const result=validateLoop(frames);assert.equal(result.passed,false);assert.ok(result.issues.some(issue=>issue.type==='loop_center_jump'||issue.type==='loop_visual_jump'));});
test('GIF preserves supplied sequence contract',()=>{const frames=[frame(0,{color:[255,0,0]}),frame(1,{color:[0,0,255]})],gif=encodeGif(frames,{frame_duration_ms:80,loop:true}),reversed=encodeGif(frames.toReversed(),{frame_duration_ms:80,loop:true});assert.equal(gif.subarray(0,6).toString(),'GIF89a');assert.equal(gif.at(-1),0x3b);assert.notDeepEqual(gif,reversed);});
