import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudflareFluxProvider,CLOUDFLARE_FLUX_MODEL} from '../automation/cloudflare-flux-provider.mjs';
import {failure} from '../automation/service.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XyVZ5wAAAABJRU5ErkJggg==','base64');
const config={enabled:true,account_id_env:'CF_TEST_ACCOUNT',api_token_env:'CF_TEST_TOKEN',timeout_ms:5000};
const resolver=async reference=>({bytes:png,mime_type:'image/png',reference});

test('Cloudflare FLUX reports missing credentials without exposing values',async()=>{
  const disabled=new CloudflareFluxProvider({...config,enabled:false},{environment:{CF_TEST_ACCOUNT:'0123456789abcdef0123456789abcdef',CF_TEST_TOKEN:'present'},assetResolver:resolver,fetch:async()=>assert.fail('request must not run')});
  assert.deepEqual({enabled:disabled.status().enabled,available:disabled.status().available,health:disabled.status().health},{enabled:false,available:false,health:'disabled'});
  const provider=new CloudflareFluxProvider(config,{environment:{},assetResolver:resolver,fetch:async()=>assert.fail('request must not run')});
  assert.equal(provider.status().available,false);assert.equal(provider.status().health,'missing_credentials');
  await assert.rejects(()=>provider.generate_frame({reference_asset:'character:c'}),/credentials are not configured/);
});

test('Cloudflare FLUX generate and edit map safe references to one output request',async()=>{
  const calls=[],secret='cf-secret-do-not-expose',fetch=async(url,options)=>{calls.push({url,options});return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({success:true,result:{image:png.toString('base64')}})};};
  const provider=new CloudflareFluxProvider(config,{environment:{CF_TEST_ACCOUNT:'0123456789abcdef0123456789abcdef',CF_TEST_TOKEN:secret},assetResolver:resolver,fetch});
  const generated=await provider.generate_frame({animation_type:'WALKING',animation_phase:'left contact',frame_index:0,total_frame_count:8,required_output_size:[512,512],reference_asset:'character:c'});
  assert.equal(generated.format,'png');assert.equal(generated.provider_metadata.output_count,1);assert.equal(generated.provider_metadata.image_input_count,1);assert.equal(calls.length,1);const requestUrl=new URL(calls[0].url);assert.equal(requestUrl.hostname,'api.cloudflare.com');assert.equal(requestUrl.pathname,'/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/run/@cf/black-forest-labs/flux-2-klein-4b');assert.equal(calls[0].options.method,'POST');assert.ok(calls[0].options.body instanceof FormData);assert.equal(calls[0].options.headers.authorization,`Bearer ${secret}`);assert.equal(Object.keys(calls[0].options.headers).some(key=>key.toLowerCase()==='content-type'),false);assert.match(calls[0].options.body.get('prompt'),/left contact/);assert.equal(calls[0].options.body.get('width'),'512');assert.equal(calls[0].options.body.get('height'),'512');assert.equal(calls[0].options.body.getAll('input_image_0').length,1);
  const edited=await provider.edit_frame({animation_type:'WALKING',frame_index:3,total_frame_count:8,required_output_size:[512,512],reference_asset:'character:c',current_frame:'frame:bad',previous_frame:'frame:p',next_frame:'frame:n',instruction:'Correct the planted foot.'});
  assert.equal(edited.provider_metadata.image_input_count,4);assert.equal(calls.length,2);for(let i=0;i<4;i++)assert.equal(calls[1].options.body.getAll(`input_image_${i}`).length,1);assert.equal(JSON.stringify({generated,edited}).includes(secret),false);assert.equal(CLOUDFLARE_FLUX_MODEL,'@cf/black-forest-labs/flux-2-klein-4b');
});

test('Cloudflare FLUX preserves sanitized API errors and is not retried',async()=>{
  let count=0;const secret='private-token',account='0123456789abcdef0123456789abcdef',provider=new CloudflareFluxProvider(config,{environment:{CF_TEST_ACCOUNT:account,CF_TEST_TOKEN:secret},assetResolver:resolver,fetch:async()=>{count++;return {ok:false,status:404,headers:{get:()=> 'application/json'},json:async()=>({success:false,errors:[{code:7003,message:`No route for ${account}; Bearer ${secret}`}]})};}});
  let error;try{await provider.generate_frame({frame_index:0,total_frame_count:1,reference_asset:'character:c'});}catch(value){error=value;}assert.equal(count,1);assert.equal(JSON.stringify(failure(error)).includes(secret),false);assert.equal(error.message.includes(account),false);assert.match(error.message,/404; code 7003/);assert.match(error.message,/No route for \[redacted\]; Bearer \[redacted\]/);
});

test('Cloudflare FLUX rejects malformed account IDs before fetch',async()=>{
  let count=0;const provider=new CloudflareFluxProvider(config,{environment:{CF_TEST_ACCOUNT:'not-an-account-id',CF_TEST_TOKEN:'private-token'},assetResolver:resolver,fetch:async()=>{count++;}});
  await assert.rejects(()=>provider.generate_frame({frame_index:0,total_frame_count:1,reference_asset:'character:c'}),/32-character hexadecimal/);assert.equal(count,0);
});
