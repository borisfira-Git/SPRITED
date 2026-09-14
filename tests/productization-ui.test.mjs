import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/library-panel.js',import.meta.url),'utf8');
const css=await readFile(new URL('../public/shell.css',import.meta.url),'utf8');
const markup=source.slice(source.indexOf('document.body.innerHTML='),source.indexOf('const style='));

test('normal product focuses on prompt generation and PNG SpriteSheet building',()=>{
  for(const id of ['characterSelect','animationType','promptFrames','promptMode','promptConstraints','generatePrompt','promptOutput','copyPrompt','fastMode','qualityMode','chooseFrames','frameFiles','chooseSheet','sheetFile','sliceColumns','sliceRows','frameList','sheetColumns','sheetWidth','sheetHeight','sheetSpacing','sheetAlignment','sheetBackgroundMode','validateFrames','qualityResult','repairPrompt','buildSheet','sheetPreview','exportSheet','exportGif'])assert.match(markup,new RegExp(`id="${id}"`));
  for(const label of ['Prompt Generator','PNG SpriteSheet Builder','Generate Prompt','Create SpriteSheet','Export PNG'])assert.ok(markup.includes(label),label);
  for(const mode of ['full_sequence','single_frame','spritesheet','continuity','repair','regenerate_bad_frames','next_frame','full_gait'])assert.ok(markup.includes(`value="${mode}"`),mode);
  assert.match(markup,/multiple hidden/);assert.match(source,/frameFiles=\[\.\.\.event\.target\.files\]/);assert.match(source,/\[frameFiles\[index\],frameFiles\[target\]\]/);
});

test('provider, API and external-client controls are absent from the normal UI',()=>{
  for(const forbidden of ['Connect Codex','Connect Cline','API key','Cloudflare','Gemini','OpenAI API','provider policy','Local Process','paid provider'])assert.equal(markup.toLowerCase().includes(forbidden.toLowerCase()),false,forbidden);
  assert.equal(markup.includes('libraryProvider'),false);assert.equal(markup.includes('connectionsDialog'),false);assert.equal(markup.includes('policyAllowPaid'),false);
});

test('updates and learning live in a drawer that is hidden by default',()=>{
  for(const id of ['updatesOpen','updatesDrawer','updatesClose','learningStats','learningEvents','learningRefresh'])assert.match(markup,new RegExp(`id="${id}"`));
  assert.match(markup,/aria-hidden="true"/);assert.match(css,/\.updates-drawer\{[^}]*transform:translateX\(105%\)/);assert.match(css,/\.updates-drawer\.open/);assert.match(source,/api\('activity\/summary'\)/);assert.doesNotMatch(source,/setInterval|setTimeout\([^)]*loadLearning/);
});

test('UI delegates prompt, import, validation and export to the existing service core',()=>{
  for(const action of ['agent/generate-animation','agent/prepare-assisted-request','animation/configure','ui/assisted-import','agent/validate-animation','agent/build-spritesheet','agent/build-gif','attempts/list'])assert.ok(source.includes(action),action);
  assert.match(source,/provider:'chatgpt_assisted'/);assert.match(source,/spacing,retention:/);assert.match(source,/keep_final_spritesheet:true/);assert.match(source,/sheetAsset\(latestSheet/);
  assert.match(source,/createImageBitmap\(file\)/);assert.match(source,/row=0;row<rows/);assert.match(source,/quality_mode:qualityMode/);assert.match(source,/quality_state/);
});

test('attempt history and advanced editor remain available as secondary tools',()=>{
  for(const id of ['attemptHistory','attemptSummary','advancedOpen'])assert.match(markup,new RegExp(`id="${id}"`));
  assert.match(source,/\/ui\/editor\.html#/);assert.match(markup,/<details class="history">/);
});
