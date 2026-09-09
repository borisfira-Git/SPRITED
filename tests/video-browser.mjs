// Local integration test. Run against scripts/preview.mjs with SPRITED_TEST_URL.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {mkdir, writeFile} from 'node:fs/promises';
const {chromium} = await import(pathToFileURL(process.env.SPRITED_PLAYWRIGHT).href);
const browser = await chromium.launch({channel:'msedge', headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[]; page.on('pageerror', e=>errors.push(e.message));
const output = process.env.SPRITED_TEST_OUTPUT;
await mkdir(output,{recursive:true});
async function saveProject() {
  const pending=page.waitForEvent('download'); await page.locator('#saveBtn').click();
  const d=await pending; const stream=await d.createReadStream(); const chunks=[];
  for await(const c of stream) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString());
}
try {
  await page.goto(process.env.SPRITED_TEST_URL || 'http://127.0.0.1:4186');
  // Real browser-recorded motion fixture with a solid green background.
  const base64=await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=160;c.height=120;const x=c.getContext('2d');
    x.fillStyle='#00ff00';x.fillRect(0,0,160,120);x.fillStyle='#c03030';x.fillRect(30,25,25,70);
    const stream=c.captureStream(12), chunks=[];
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
    recorder.ondataavailable=e=>chunks.push(e.data);
    const done=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
    for(let i=0;i<24;i++) {x.fillStyle='#00ff00';x.fillRect(0,0,160,120);x.fillStyle='#c03030';x.fillRect(30+i*2,25,25,70);await new Promise(r=>setTimeout(r,85));}
    recorder.stop();await done;stream.getTracks().forEach(t=>t.stop());
    const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());return btoa(String.fromCharCode(...bytes));
  });
  const clip=Buffer.from(base64,'base64');await writeFile(`${output}/motion-fixture.webm`,clip);
  await page.locator('#videoBtn').click();
  await page.locator('dialog input[name=file]').setInputFiles({name:'motion.webm',mimeType:'video/webm',buffer:clip});
  await page.locator('dialog button[name=import]').waitFor();
  await page.waitForFunction(()=>!document.querySelector('dialog button[name=import]').disabled);
  await page.locator('dialog input[name=end]').fill('2');
  await page.locator('dialog input[name=count]').fill('8');
  await page.locator('dialog button[name=import]').click();
  await page.waitForFunction(()=>!document.querySelector('dialog'));
  const original=await saveProject();assert.equal(original.frames.length,8);
  assert.equal(original.frames[0].duration,250);
  assert.equal(original.fps,4);
  assert.equal(original.frames[7].videoSource.time,1.75);
  assert.ok(new Set(original.frames.map(f=>f.src)).size>=6,'decoded frames show continuous motion');
  await page.locator('#undoBtn').click();assert.equal((await saveProject()).frames.length,0);
  await page.locator('#redoBtn').click();assert.equal((await saveProject()).frames.length,8);
  // Cancelled imports and rejected ranges must leave existing frames untouched.
  await page.locator('#videoBtn').click();await page.locator('dialog button[name=cancel]').click();
  assert.deepEqual((await saveProject()).frames,original.frames);
  await page.locator('#videoBtn').click();
  await page.locator('dialog input[name=file]').setInputFiles({name:'motion.webm',mimeType:'video/webm',buffer:clip});
  await page.waitForFunction(()=>!document.querySelector('dialog button[name=import]').disabled);
  await page.locator('dialog input[name=end]').fill('0');await page.locator('dialog button[name=import]').click();
  await page.getByText('Choose a valid time range, 1–120 frames, and a size from 64–1024 px.',{exact:true}).waitFor();
  await page.locator('dialog button[name=cancel]').click();assert.deepEqual((await saveProject()).frames,original.frames);
  await page.locator('#removeBgAllBtn').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent==='Background removed');
  await page.getByRole('button',{name:'Align All Frames to Body',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent==='Frames aligned by body');
  const aligned=await saveProject(); assert.ok(aligned.frames.every(f=>f.bodyAligned));
  assert.equal(new Set(aligned.frames.map(f=>f.scale)).size,1);
  await page.locator('#propX').fill('7');await page.locator('#propX').dispatchEvent('change');
  const manual=await saveProject();
  await page.locator('#exportBtn').click();
  const exported=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export Sprite Sheet',exact:true}).click();
  const download=await exported;await download.saveAs(`${output}/video-spritesheet.png`);
  assert.deepEqual((await saveProject()).frames,manual.frames,'export preserves edits');
  await page.screenshot({path:`${output}/sprited-video-preview.png`});
  assert.deepEqual(errors,[]);
  console.log('PASS: real WebM decode, 8 ordered samples, timing, undo/redo, cancel, range error, background removal, shared scale, alignment, PNG export, manual edit preservation.');
} finally {await browser.close();}
