// These hints describe logical workspace effects, excluding temporary review caches.
// Unknown write tools are conservatively non-idempotent until their replay behavior
// is established. Stable operation keys and exact caches justify the entries below.
const idempotentWrites = new Set([
  'aftertake_voice',
  'aftertake_save_plan',
  'aftertake_save_film_edit',
  'aftertake_export_plan',
  'aftertake_generate_image',
  'aftertake_generate_video',
  'aftertake_edit_frame',
  'aftertake_render_take',
  'aftertake_enhance',
  'aftertake_track_character',
  'aftertake_replace_character',
  'aftertake_use_source',
  'aftertake_rejoin_script',
  'aftertake_duplicate_subject',
  'aftertake_finish_media',
  'aftertake_depth_effect',
  'aftertake_compose_layers',
  'aftertake_refine_blend',
  'aftertake_make_one_tap_effect',
  'aftertake_one_tap_watermark',
  'aftertake_make_storyboard',
]);
const destructiveWrites = new Set([
  'aftertake_generation_action',
  'aftertake_character_action',
  'aftertake_cancel_finishing',
  'aftertake_depth_action',
  'aftertake_cancel_blend',
]);

export function toolAnnotations(name: string, readOnly: boolean) {
  return {
    readOnlyHint: readOnly,
    destructiveHint: !readOnly && destructiveWrites.has(name),
    idempotentHint: readOnly || idempotentWrites.has(name),
    openWorldHint: false,
  };
}
