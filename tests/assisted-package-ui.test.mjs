import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';

test('packaged ChatGPT Assisted request, import, preview and export controls are available',async()=>{
  const packageRoot=path.resolve(process.argv[2]),dataRoot=path.resolve(process.argv[3]),log=await readFile(path.join(dataRoot,'library-server.log'),'utf8'),address=[...log.matchAll(/Library: (http:\/\/127\.0\.0\.1:\d+\/ui\/#\S+)/g)].at(-1)?.[1];assert.ok(address);const parsed=new URL(address),token=parsed.hash.slice(1),headers={authorization:`Bearer ${token}`};
  let characters=await fetch(new URL('/character/list',parsed.origin),{headers}).then(response=>response.json());if(!characters.result.length){const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XyVZ5wAAAABJRU5ErkJggg==','base64');await fetch(new URL('/ui/reference?name=Assisted%20Package',parsed.origin),{method:'POST',headers:{...headers,'content-type':'image/png'},body:png});}
  const require=createRequire(import.meta.url),playwright=require(path.join(packageRoot,'automation','node_modules','playwright-core')),browser=await playwright.chromium.launch({channel:'msedge',headless:true});
  try{const page=await browser.newPage({viewport:{width:1440,height:960}});await page.goto(address);await page.waitForFunction(()=>document.querySelectorAll('#animationCards button').length===6);assert.equal(await page.locator('#libraryGenerate').isDisabled(),false);assert.equal(await page.locator('#libraryProvider').isVisible(),true);await page.locator('#libraryProvider').selectOption('chatgpt_assisted');assert.equal(await page.locator('#assistedToolbar').isVisible(),true);await page.locator('#libraryGenerate').click();await page.waitForTimeout(3000);assert.equal(await page.locator('#assistedDialog').evaluate(element=>element.open),true,(await page.locator('#libraryStatus').textContent())+' | '+(await page.locator('#libraryDetails').textContent()));assert.match(await page.locator('#assistedPrompt').inputValue(),/frame 1 of an 8-frame/i);assert.equal(await page.locator('#assistedFile').getAttribute('multiple'),'');for(const id of ['assistedImportMain','libraryGifPreview','libraryGifExport','librarySheet'])assert.equal(await page.locator('#'+id).count(),1);await page.locator('#assistedClose').click();await page.reload();await page.waitForFunction(()=>document.getElementById('libraryTitle')?.textContent.length>0);}
  finally{await browser.close();}
});


