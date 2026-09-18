import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEvenLoop} from '../automation/even-timing-normalizer.mjs';

const frames = count => Array.from({length: count}, (_, frame_index) => ({frame_index, frame_id: `frame-${frame_index}`}));

test('8-frame loop is segmented into eight equal 12.5 percent phases', () => {
  const result = normalizeEvenLoop({frames: frames(16), target_frame_count: 8});
  assert.deepEqual(result.target_phase_percents, [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5]);
  assert.deepEqual(result.matched_frames, [0, 2, 4, 6, 8, 10, 12, 14]);
  assert.equal(result.export_ready, true);
});

test('12-frame loop exposes exact thirds-of-a-frame percentages and phase map', () => {
  const result = normalizeEvenLoop({frames: frames(12), target_frame_count: 12});
  assert.equal(result.target_phase_percents[1], 8.333333);
  assert.equal(result.phase_map[11].target_phase_percent, 91.666667);
  assert.equal(result.phase_map[11].matched_source_frame, 11);
});

test('loop validation includes the final phase back to phase zero', () => {
  const result = normalizeEvenLoop({frames: frames(8), target_frame_count: 8});
  assert.equal(result.transitions.length, 8);
  assert.deepEqual(result.transitions.at(-1), {from_phase_index:7,to_phase_index:0,from_source_frame:7,to_source_frame:0,loop_relevance:true,temporal_gap:.125});
});

test('walking eight-phase support checks contralateral continuation', () => {
  const result = normalizeEvenLoop({frames: frames(8), target_frame_count: 8, animation_type: 'WALKING'});
  assert.deepEqual(result.walk_cycle.phase_labels.map(item => item.label), ['Left Contact','Left Down','Left Passing','Left Up','Right Contact','Right Down','Right Passing','Right Up']);
  assert.equal(result.walk_cycle.contralateral, true);
  assert.equal(result.walk_cycle.opposite_contact_spacing, .5);
  assert.equal(result.walk_cycle.continuation, true);
});

test('strict mode fails when source timing cannot meet equal phases', () => {
  const result = normalizeEvenLoop({frames: frames(8).map((frame, index) => ({...frame, duration_ms: index === 0 ? 900 : 10})), target_frame_count: 8, strict_mode: true});
  assert.equal(result.export_ready, false);
  assert.ok(result.diagnostics.blockers.some(item => item.includes('Strict mode')));
});

test('strict mode refuses source duplicate or near-duplicate transitions', () => {
  const result = normalizeEvenLoop({frames: frames(8), target_frame_count: 8, strict_mode: true, source_quality: {duplicate_or_near_duplicate_count: 1}});
  assert.equal(result.export_ready, false);
  assert.ok(result.diagnostics.blockers.some(item => item.includes('duplicate or near-duplicate')));
});

test('insufficient sources fail gracefully and preserve anchor matches in the report', () => {
  const result = normalizeEvenLoop({frames: [{...frames(4)[0], anchor:true}, ...frames(4).slice(1)], target_frame_count: 8});
  assert.equal(result.export_ready, false);
  assert.ok(result.diagnostics.blockers.some(item => item.includes('Source has 4')));
  assert.equal(result.phase_map[0].reused_anchor, true);
  assert.match(result.repair_recommendation, /rebuild_even_timed_loop/);
});
