const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const round = (value, digits = 6) => Number(value.toFixed(digits));

const WALK_PHASES = Object.freeze([
  'Left Contact', 'Left Down', 'Left Passing', 'Left Up',
  'Right Contact', 'Right Down', 'Right Passing', 'Right Up'
]);

function sourceTimeline(frames) {
  const ordered = [...frames].sort((a, b) => a.frame_index - b.frame_index);
  const durations = ordered.map(frame => Number.isFinite(frame.duration_ms) && frame.duration_ms > 0 ? frame.duration_ms : 1);
  const total = durations.reduce((sum, value) => sum + value, 0);
  let elapsed = 0;
  return ordered.map((frame, index) => {
    const phase = elapsed / total;
    elapsed += durations[index];
    return {...frame, source_phase_percent: round(phase * 100), source_phase: phase, duration_ms: durations[index]};
  });
}

function circularDistance(a, b) {
  const distance = Math.abs(a - b);
  return Math.min(distance, 1 - distance);
}

function walkDiagnostics(matches, targetCount, source) {
  if (targetCount !== 8) return {phase_labels: [], contralateral: null, opposite_contact_spacing: null, continuation: null};
  const labels = WALK_PHASES.map((label, index) => ({target_phase_index: index, label}));
  const contacts = matches.filter(item => item.phase_label?.includes('Contact'));
  const oppositeContactSpacing = contacts.length === 2 ? circularDistance(contacts[0].target_phase, contacts[1].target_phase) : null;
  const firstHalf = matches.slice(0, 4).map(item => item.matched_source_frame);
  const secondHalf = matches.slice(4).map(item => item.matched_source_frame);
  const continuation = secondHalf.length === 4 && new Set(secondHalf).size === 4 && firstHalf.some((value, index) => value === secondHalf[index]) === false;
  const sourceHalf = Math.max(1, Math.floor(source.length / 2));
  const contralateral = source.length >= 8 && contacts.length === 2 && Math.abs((contacts[1].matched_source_frame - contacts[0].matched_source_frame + source.length) % source.length - sourceHalf) <= 1;
  return {phase_labels: labels, contralateral, opposite_contact_spacing: oppositeContactSpacing == null ? null : round(oppositeContactSpacing), continuation};
}

export function normalizeEvenLoop({frames = [], target_frame_count, animation_type = 'ANY', strict_mode = false, loop_start = 0, loop_end = 1, temporal_tolerance = null, source_quality = {}} = {}) {
  const blockers = [], warnings = [];
  if (!Number.isInteger(target_frame_count) || target_frame_count < 2) blockers.push('target_frame_count must be an integer of at least 2');
  if (!Array.isArray(frames) || frames.length < 2) blockers.push('At least two source frames are required to model a loop');
  if (!(loop_end > loop_start)) blockers.push('loop_end must be greater than loop_start');
  if (blockers.length) return {source_frame_count: frames?.length || 0, target_frame_count, target_phase_percents: [], phase_map: [], diagnostics: {temporal_confidence: 0, loop_confidence: 0, export_ready: false, blockers, warnings}};

  const source = sourceTimeline(frames);
  const span = loop_end - loop_start;
  const tolerance = temporal_tolerance ?? Math.max(0.06, 0.5 / target_frame_count);
  const phaseMap = [];
  const used = new Set();
  for (let index = 0; index < target_frame_count; index++) {
    const targetPhase = clamp(loop_start + (index / target_frame_count) * span);
    const candidates = source.map((frame, sourceIndex) => ({frame, sourceIndex, distance: circularDistance(frame.source_phase, targetPhase)})).sort((a, b) => a.distance - b.distance || a.sourceIndex - b.sourceIndex);
    const unique = candidates.find(candidate => !used.has(candidate.sourceIndex)) || candidates[0];
    if (unique) used.add(unique.sourceIndex);
    const error = unique ? unique.distance : 1;
    phaseMap.push({
      target_phase_index: index,
      target_phase_percent: round((index / target_frame_count) * 100),
      target_phase: round(index / target_frame_count),
      matched_source_frame: unique?.frame.frame_index ?? null,
      matched_source_frame_id: unique?.frame.frame_id ?? null,
      matched_source_phase_percent: unique?.frame.source_phase_percent ?? null,
      temporal_distance: round(error),
      temporal_error_percent: round(error * 100, 4),
      reused_anchor: Boolean(unique?.frame.anchor || unique?.frame.is_anchor || unique?.frame.phase_anchor),
      phase_label: animation_type === 'WALKING' && target_frame_count === 8 ? WALK_PHASES[index] : null
    });
  }

  const errors = phaseMap.map(item => item.temporal_distance);
  const averageError = errors.reduce((sum, value) => sum + value, 0) / errors.length;
  const maxError = Math.max(...errors);
  const duplicateCount = phaseMap.length - new Set(phaseMap.map(item => item.matched_source_frame)).size;
  const visualDuplicateCount = Number(source_quality.duplicate_or_near_duplicate_count || 0);
  const sourceInsufficient = source.length < target_frame_count;
  if (sourceInsufficient) blockers.push(`Source has ${source.length} frame${source.length === 1 ? '' : 's'} but ${target_frame_count} evenly timed phases were requested; interpolation or rebuild is required`);
  if (duplicateCount) warnings.push(`${duplicateCount} target phases reuse a source frame`);
  if (visualDuplicateCount) warnings.push(`${visualDuplicateCount} source transition${visualDuplicateCount === 1 ? '' : 's'} contain duplicate or near-duplicate imagery`);
  if (maxError > tolerance) warnings.push(`Largest temporal phase error is ${(maxError * 100).toFixed(2)}%`);

  const loopTransitions = phaseMap.map((item, index) => ({from_phase_index: index, to_phase_index: (index + 1) % phaseMap.length, from_source_frame: item.matched_source_frame, to_source_frame: phaseMap[(index + 1) % phaseMap.length].matched_source_frame, loop_relevance: index === phaseMap.length - 1, temporal_gap: round(circularDistance(item.target_phase, phaseMap[(index + 1) % phaseMap.length].target_phase))}));
  const loopTransition = loopTransitions.at(-1);
  const loopConfidence = loopTransition && loopTransition.from_source_frame != null && loopTransition.to_source_frame != null ? (loopTransition.from_source_frame === loopTransition.to_source_frame ? 0.35 : 0.95) : 0;
  const temporalConfidence = clamp(1 - averageError * 2 - (duplicateCount ? 0.25 : 0));
  const walk = animation_type === 'WALKING' ? walkDiagnostics(phaseMap, target_frame_count, source) : null;
  if (walk?.contralateral === false) warnings.push('Walking contacts are not approximately half a cycle apart');
  if (walk?.continuation === false) warnings.push('Walking second half may repeat the first half instead of continuing the opposite side');
  if (strict_mode && sourceInsufficient) blockers.push('Strict mode refuses export without a source moment for every requested phase');
  if (strict_mode && (temporalConfidence < 0.75 || loopConfidence < 0.75)) blockers.push('Strict mode requires higher equal-phase and loop confidence');
  if (strict_mode && duplicateCount) blockers.push('Strict mode refuses duplicate or near-duplicate phase matches');
  if (strict_mode && visualDuplicateCount) blockers.push('Strict mode refuses source duplicate or near-duplicate transitions');

  const exportReady = blockers.length === 0;
  return {
    source_frame_count: source.length,
    target_frame_count,
    target_phase_percents: phaseMap.map(item => item.target_phase_percent),
    phase_map: phaseMap,
    matched_frames: phaseMap.map(item => item.matched_source_frame),
    transitions: loopTransitions,
    walk_cycle: walk,
    diagnostics: {temporal_confidence: round(temporalConfidence), loop_confidence: round(loopConfidence), export_ready: exportReady, blockers, warnings},
    export_ready: exportReady,
    repair_recommendation: exportReady ? null : 'Add or rebuild source frames at the missing phases, then rerun rebuild_even_timed_loop.'
  };
}

export {WALK_PHASES};
