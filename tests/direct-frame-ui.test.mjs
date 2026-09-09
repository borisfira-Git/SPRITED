import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Service} from '../automation/service.mjs';
import {serve} from '../automation/http.mjs';

const root=path.resolve(process.env.SPRITED_TEST_WORKSPACE),output=path.resolve('test-results/mcp-v1/direct-frame-ui.png');
await mkdir(path.dirname(output),{recursive:true});
const service=new Service(root);let server,browser;
try{
  await service.init();server=await serve(service,0,'direct-frame-ui-test');
  const {chromium}=await import(pathToFileURL(process.env.SPRITED_PLAYWRIGHT).href);browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1536,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.port}/ui/#direct-frame-ui-test`);await page.waitForFunction(()=>document.getElementById('libraryFramePreview')?.naturalWidth>0&&document.getElementById('resultCounter')?.textContent.includes('Result 2 of 2'));
  assert.deepEqual(errors,[]);assert.equal(await page.locator('#libraryVideoPreview').count(),0);assert.equal(await page.locator('video').count(),0);assert.match(await page.locator('.shell-footer').textContent(),/Direct frame workflow/);assert.match(await page.locator('#resultCounter').textContent(),/Result 2 of 2/);
  await page.screenshot({path:output,fullPage:true});console.log(`PASS: direct-frame shell launched; screenshot ${output}`);
}finally{await browser?.close();if(server)await new Promise(resolve=>server.server.close(resolve));await service.close();}
