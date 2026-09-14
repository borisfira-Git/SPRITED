import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

if(process.env.SPRITED_LIVE_CONFIG_TEST!=='1')throw Error('Set SPRITED_LIVE_CONFIG_TEST=1 for the explicit live Codex configuration test');
const dataRoot=path.join(process.env.LOCALAPPDATA,'SPRITED'),log=path.join(dataRoot,'library-server.log'),config=path.join(os.homedir(),'.codex','config.toml'),backup=config+'.sprited-backup';
async function currentUrl(){const text=await readFile(log,'utf8'),match=[...text.matchAll(/Library: (http:\/\/127\.0\.0\.1:\d+\/ui\/#\S+)/g)].at(-1);if(!match)throw Error('SPRITED library URL not found');return match[1];}
async function identity(url){const parsed=new URL(url);return fetch(parsed.origin+'/identity',{headers:{authorization:'Bearer '+parsed.hash.slice(1)}}).then(response=>response.json());}
function unrelatedSections(text){const sections=new Map(),lines=text.match(/[^\r\n]*(?:\r\n|\n|$)/g).filter(Boolean);let name='__root__';for(const line of lines){const match=line.trim().match(/^\[([^\]]+)\]/);if(match)name=match[1];if(name==='mcp_servers.sprited'||name==='mcp_servers.sprited.env')continue;sections.set(name,(sections.get(name)||'')+line);}return [...sections].map(([key,value])=>[key,value.trimEnd()]);}

const url=await currentUrl(),live=await identity(url);assert.equal(live.application,'SPRITED');
const before=await readFile(config,'utf8'),beforeUnrelated=unrelatedSections(before),token=new URL(url).hash.slice(1),require=createRequire(import.meta.url),playwright=require(path.resolve('automation/node_modules/playwright-core')),browser=await playwright.chromium.launch({channel:'msedge',headless:true});
try{const page=await browser.newPage();page.setDefaultTimeout(15000);await page.goto(url);await page.waitForSelector('#librarySettings');await page.locator('#librarySettings').click();await page.locator('#connectCodex').click();await page.waitForFunction(()=>document.getElementById('connectionAgent')?.textContent==='Codex configured');assert.equal(await page.locator('#connectionTokenStatus').textContent(),'Token synchronized: Yes');assert.equal(await page.locator('#connectionTokenStatus').isVisible(),true);assert.match(await page.locator('#connectionResult').textContent(),/Restart or reconnect the client, then press Test Connection/);assert.equal((await page.locator('#connectionsDialog').textContent()).includes(token),false);}finally{await browser.close();}
const after=await readFile(config,'utf8'),savedBackup=await readFile(backup,'utf8');assert.equal(savedBackup,before);assert.deepEqual(unrelatedSections(after),beforeUnrelated);assert.ok(after.includes('SPRITED_TOKEN'));assert.ok(after.includes(token));console.log(JSON.stringify({click_reached_endpoint:true,config_modified:after!==before,backup_created:true,unrelated_sections_preserved:true,token_synchronized_without_ui_disclosure:true,ui_success_state:true}));
