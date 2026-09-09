import test from 'node:test';
import assert from 'node:assert/strict';
await import('../public/video-import.js');
const plan = globalThis.SpritedVideo.plan;
const options = {start: 1, end: 3, count: 24, maxSize: 512};
test('samples an end-exclusive range with exact total duration', () => {
  const p = plan(4, 1920, 1080, options);
  assert.equal(p.times[0], 1); assert.ok(p.times.at(-1) < 3);
  assert.equal(p.duration * p.times.length, 2000);
  assert.deepEqual([p.width, p.height], [512, 288]);
});
test('never upscales and permits one frame', () => {
  assert.equal(plan(4, 128, 64, {...options, count: 1}).width, 128);
});
test('rejects invalid ranges and nonfinite values', () => {
  for (const change of [{start:-1}, {end:5}, {end:1}, {count:0}, {count:121}, {count:2.5}, {maxSize:2048}, {start:NaN}])
    assert.throws(() => plan(4, 100, 100, {...options, ...change}));
});
test('rejects excessive decoded memory', () => {
  assert.throws(() => plan(4, 1024, 1024, {...options, maxSize:1024, count:120}), /pixels/);
});
