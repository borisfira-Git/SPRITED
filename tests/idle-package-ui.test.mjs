import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';

test('packaged UI stays unchanged and performs no state polling while idle',async()=>{
  const packageRoot=path.resolve(process.argv[2]);
  const dataRoot=path.resolve(process.argv[3]);
  const log=await readFile(path.join(dataRoot,'library-server.log'),'utf8');
  const address=[...log.matchAll(/Library: (http:\/\/127\.0\.0\.1:\d+\/ui\/#\S+)/g)].at(-1)?.[1];
  assert.ok(address,'Packaged server URL was not written');
  const require=createRequire(import.meta.url);
  const playwright=require(path.join(packageRoot,'automation','node_modules','playwright-core'));
  const browser=await playwright.chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:960}}),stateRequests=[];
    page.on('request',request=>{if(['/character/list','/attempts/list','/jobs/list','/connections/status'].includes(new URL(request.url()).pathname))stateRequests.push(request.url());});
    await page.goto(address);
    await page.waitForFunction(()=>document.querySelectorAll('#animationCards button').length===6&&!document.getElementById('libraryGenerate').disabled);
    await page.locator('#animationCards button[data-type="ATTACK"]').click();
    await page.locator('#libraryFrames').selectOption('12');
    await page.locator('#libraryAdvanced > summary').click();
    const selectedCharacter=await page.locator('#libraryCharacters').inputValue();
    stateRequests.length=0;
    await page.waitForTimeout(5500);
    assert.deepEqual(stateRequests,[]);
    assert.equal(await page.locator('#libraryCharacters').inputValue(),selectedCharacter);
    assert.equal(await page.locator('#libraryType').inputValue(),'ATTACK');
    assert.equal(await page.locator('#libraryFrames').inputValue(),'12');
    assert.equal(await page.locator('#libraryAdvanced').getAttribute('open'),'');
  }finally{await browser.close();}
});
