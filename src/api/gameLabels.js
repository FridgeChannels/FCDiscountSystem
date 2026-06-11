const TEMPLATE_LABELS = {
  match_product_to_scene: 'Match · Scene',
  memory_match: 'Card Match',
  rps_choice: 'Rock Paper Scissors',
  merge_2048: '2048',
  slice_blocks: 'Slice Blocks',
  dodge_plane: 'Dodge Plane',
  bridge_cross: 'Bridge Cross',
  sorting_sort: 'Sorting',
  timing_stop: 'Timing Stop',
  tap: 'Tap Target',
  spin: 'Lucky Spin',
};

const TEMPLATE_ICONS = {
  match_product_to_scene: '🎮',
  memory_match: '🃏',
  rps_choice: '✊',
  merge_2048: '🔢',
  slice_blocks: '🔪',
  dodge_plane: '✈️',
  bridge_cross: '🌉',
  sorting_sort: '📦',
  timing_stop: '⏱️',
  tap: '🎮',
  spin: '🎡',
};

export function labelForTemplate(templateKey) {
  return TEMPLATE_LABELS[templateKey] ?? templateKey;
}

export function iconForTemplate(templateKey) {
  return TEMPLATE_ICONS[templateKey] ?? '🎮';
}
