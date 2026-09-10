import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {mapWorkflow} from '../automation/providers/sprited-comfy-bridge.mjs';

const workflowPath=name=>fileURLToPath(new URL(`../automation/providers/workflows/${name}`,import.meta.url));
const readWorkflow=async name=>JSON.parse(await readFile(workflowPath(name),'utf8'));
const placeholders={
  instruction:'Keep the leading foot planted.',
  animation_id:'guardian-walk',
  animation_type:'WALKING',
  frame_index:3,
  reference_image:'input/reference.png',
  current_frame:'input/current.png',
  previous_frame:'input/previous.png',
  next_frame:'input/next.png',
  output_filename:'sprited-guardian-walk-3'
};

function placeholderNames(workflow){
  return new Set([...JSON.stringify(workflow).matchAll(/\{\{([a-z_]+)\}\}/g)].map(match=>match[1]));
}

function validateGraph(workflow){
  const outputs=Object.entries(workflow).filter(([,node])=>node.class_type==='SaveImage');
  assert.equal(outputs.length,1,'workflow must have exactly one image output');
  const [outputId,output]=outputs[0];
  assert.equal(output.inputs.filename_prefix,'{{output_filename}}');
  assert.ok(Array.isArray(output.inputs.images));
  assert.ok(workflow[String(output.inputs.images[0])],`output ${outputId} must reference an existing image node`);
  for(const [id,node] of Object.entries(workflow)){
    for(const value of Object.values(node.inputs||{})){
      if(Array.isArray(value)&&typeof value[0]==='string'&&/^\d+$/.test(value[0]))assert.ok(workflow[value[0]],`node ${id} references missing node ${value[0]}`);
    }
  }
}

test('generate workflow is a valid injectable single-output API graph',async()=>{
  const workflow=await readWorkflow('comfy-generate-frame.json'),names=placeholderNames(workflow);
  for(const name of ['instruction','animation_id','animation_type','frame_index','reference_image','output_filename'])assert.ok(names.has(name),`missing ${name}`);
  assert.ok(!names.has('previous_frame')&&!names.has('next_frame'),'optional neighbors must not become required inputs');
  validateGraph(workflow);
  const mapped=mapWorkflow(workflow,placeholders);
  assert.equal(mapped['2'].inputs.image,placeholders.reference_image);
  assert.equal(mapped['6'].inputs.seed,placeholders.frame_index);
  assert.equal(mapped['8'].inputs.filename_prefix,placeholders.output_filename);
});

test('edit workflow consumes identity and neighbor context and has one output',async()=>{
  const workflow=await readWorkflow('comfy-edit-frame.json'),names=placeholderNames(workflow);
  for(const name of Object.keys(placeholders))assert.ok(names.has(name),`missing ${name}`);
  validateGraph(workflow);
  const mapped=mapWorkflow(workflow,placeholders);
  assert.equal(mapped['2'].inputs.image,placeholders.current_frame);
  assert.equal(mapped['3'].inputs.image,placeholders.reference_image);
  assert.equal(mapped['4'].inputs.image,placeholders.previous_frame);
  assert.equal(mapped['5'].inputs.image,placeholders.next_frame);
  assert.equal(mapped['12'].inputs.seed,placeholders.frame_index);
  assert.equal(mapped['14'].inputs.filename_prefix,placeholders.output_filename);
});

test('workflow templates contain no host filesystem paths',async()=>{
  for(const name of ['comfy-generate-frame.json','comfy-edit-frame.json']){
    const serialized=JSON.stringify(await readWorkflow(name));
    assert.doesNotMatch(serialized,/[A-Za-z]:\\|\/(?:Users|home|tmp)\//);
  }
});
