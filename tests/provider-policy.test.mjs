import test from 'node:test';
import assert from 'node:assert/strict';
import {ExternalManualProvider,ChatGPTAssistedProvider,LocalProcessProvider} from '../automation/image-provider.mjs';
import {Service} from '../automation/service.mjs';
import {serve} from '../automation/http.mjs';
import {normalizeProviderPolicy,providerCapabilities,selectProvider,authorizePaidRequest} from '../automation/provider-policy.mjs';
await import('../public/character-workflow.js');

const api=(id,available=true)=>({id,status:()=>({id,available,health:available?'ready':'missing_api_key'})});
const instances={external_manual:new ExternalManualProvider(),chatgpt_assisted:new ChatGPTAssistedProvider(),local_process:new LocalProcessProvider({enabled:false}),openai_api:api('openai_api'),gemini_api:api('gemini_api')};

test('provider capability metadata classifies assisted, local, and paid automatic providers',()=>{
  const values=providerCapabilities(instances),find=id=>values.find(item=>item.provider_id===id);assert.deepEqual({mode:find('chatgpt_assisted').generation_mode,paid:find('chatgpt_assisted').may_incur_cost,key:find('chatgpt_assisted').requires_api_key},{mode:'assisted',paid:false,key:false});assert.deepEqual({mode:find('openai_api').generation_mode,paid:find('openai_api').may_incur_cost,key:find('openai_api').requires_api_key},{mode:'automatic',paid:true,key:true});assert.equal(find('gemini_api').may_incur_cost,true);assert.equal(find('external_manual').may_incur_cost,false);assert.equal(find('local_process').generation_mode,'local');assert.equal(find('local_process').available,false);assert.equal(JSON.stringify(values).includes('api_key'),true);assert.equal(JSON.stringify(values).includes('secret'),false);
});

test('paid request gate requires policy permission, one-request confirmation, and remaining allowance',()=>{
  const decision=selectProvider(normalizeProviderPolicy({default_provider:'openai_api'}),'openai_api',instances);assert.throws(()=>authorizePaidRequest({default_provider:'openai_api'},decision,{},'generation',true),/disabled/);
  const policy=normalizeProviderPolicy({default_provider:'openai_api',allow_paid_providers:true,require_confirmation_for_paid_request:true,max_paid_image_generations_per_animation:1,max_paid_repair_generations_per_animation:1});assert.throws(()=>authorizePaidRequest(policy,decision,{},'generation',false),/Explicit confirmation/);assert.deepEqual(authorizePaidRequest(policy,decision,{},'generation',true),{paid:true,counter:'paid_generations',next:1,limit:1});assert.throws(()=>authorizePaidRequest(policy,decision,{paid_generations:1},'generation',true),/generation limit reached/);assert.throws(()=>authorizePaidRequest(policy,decision,{paid_repairs:1},'repair',true),/repair limit reached/);
});

test('fallback order never skips an available assisted provider and paid fallback is opt-in',()=>{
  let policy=normalizeProviderPolicy({default_provider:'chatgpt_assisted',fallback_providers:['gemini_api','external_manual'],allow_paid_providers:true,allow_automatic_paid_fallback:true});let decision=selectProvider(policy,null,instances);assert.equal(decision.selected_provider,'chatgpt_assisted');assert.equal(decision.user_action_required,true);assert.equal(decision.paid_request,false);
  const unavailable={...instances,openai_api:api('openai_api',false)};policy=normalizeProviderPolicy({default_provider:'openai_api',fallback_providers:['gemini_api','external_manual'],allow_paid_providers:true});decision=selectProvider(policy,null,unavailable);assert.equal(decision.selected_provider,'external_manual');assert.equal(decision.user_action_required,true);policy=normalizeProviderPolicy({...policy,allow_automatic_paid_fallback:true});decision=selectProvider(policy,null,unavailable);assert.equal(decision.selected_provider,'gemini_api');assert.equal(decision.paid_request,true);
});

test('ChatGPT Assisted returns user_action_required with a prepared request',async()=>{
  const workflow=globalThis.SpritedWorkflow,state=workflow.empty(),source='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XyVZ5wAAAABJRU5ErkJggg==',character=workflow.setReference(state,{src:source,name:'Assisted'}),run=workflow.create(state,'WALKING'),service={defaultImageProvider:'chatgpt_assisted',providerPolicy:normalizeProviderPolicy({default_provider:'chatgpt_assisted'}),imageProviders:{external_manual:new ExternalManualProvider(),chatgpt_assisted:new ChatGPTAssistedProvider()},core:async operation=>{if(operation==='workflow/animation/status')return run;throw Error('Unexpected core operation');}};
  const result=await Service.prototype.storeProviderFrame.call(service,{animation_id:run.id,frame_index:0,provider:'chatgpt_assisted'},false);assert.equal(result.selected_provider,'chatgpt_assisted');assert.equal(result.generation_mode,'assisted');assert.equal(result.user_action_required,true);assert.equal(result.paid_request,false);assert.equal(result.prepared_request.provider_id,'chatgpt_assisted');assert.match(result.prepared_request.prompt,/frame 1 of an 8-frame walking animation/i);
});

test('provider policy status is readable over the authenticated HTTP API',async()=>{
  const token='provider-policy-http-test',running=await serve({root:process.cwd(),call:async(action)=>{assert.equal(action,'provider-policy/status');return {success:true,result:{default_provider:'chatgpt_assisted'},warnings:[],errors:[],output_paths:[]};}},0,token);
  try{const response=await fetch(`http://127.0.0.1:${running.port}/provider-policy/status`,{headers:{authorization:`Bearer ${token}`}});assert.equal(response.status,200);assert.equal((await response.json()).result.default_provider,'chatgpt_assisted');}
  finally{await new Promise(resolve=>running.server.close(resolve));}
});
