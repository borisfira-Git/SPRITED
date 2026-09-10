import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {ExternalManualProvider,LocalProcessProvider} from '../automation/image-provider.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XyVZ5wAAAABJRU5ErkJggg==','base64'),script=fileURLToPath(new URL('./fixtures/local-image-generator.mjs',import.meta.url));
const runtime=async(mode,timeout_ms=3000)=>{const root=await mkdtemp(path.join(os.tmpdir(),'sprited-provider-')),provider=new LocalProcessProvider({enabled:true,executable:process.execPath,script,arguments:[mode],timeout_ms},{tempRoot:root,assetResolver:async()=>({bytes:png,mime_type:'image/png'})});return {root,provider};};

test('ExternalManualProvider remains compatible',async()=>{const result=await new ExternalManualProvider().generate_frame({format:'png',image_base64:png.toString('base64')});assert.equal(result.provider,'external_manual');assert.ok(result.bytes.equals(png));});
test('LocalProcessProvider generates and edits normalized PNG frames',async()=>{const {root,provider}=await runtime('success');try{const context={animation_id:'a',frame_index:2,animation_type:'WALKING',reference_asset:'character:c',current_frame:'frame:f',assets:{reference:'character:c',current:'frame:f'}};for(const operation of ['generate_frame','edit_frame']){const result=await provider[operation](context);assert.equal(result.provider,'local_process');assert.equal(result.format,'png');assert.ok(result.bytes.equals(png));}}finally{await rm(root,{recursive:true,force:true});}});
test('LocalProcessProvider reports timeout and process failure cleanly',async()=>{let value=await runtime('timeout',100);try{await assert.rejects(()=>value.provider.generate_frame({assets:{reference:'character:c'}}),/timed out/);}finally{await rm(value.root,{recursive:true,force:true});}value=await runtime('failure');try{await assert.rejects(()=>value.provider.generate_frame({assets:{reference:'character:c'}}),/exit code 7/);}finally{await rm(value.root,{recursive:true,force:true});}});
test('LocalProcessProvider rejects invalid image output',async()=>{const {root,provider}=await runtime('invalid');try{await assert.rejects(()=>provider.generate_frame({assets:{reference:'character:c'}}),/valid PNG/);}finally{await rm(root,{recursive:true,force:true});}});
