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
  'aftertake_track_character',
  'aftertake_replace_character',
  'aftertake_use_source',
  'aftertake_rejoin_script',
  'aftertake_duplicate_subject',
  'aftertake_finish_media',
  'aftertake_depth_effect',
  'aftertake_compose_layers',
  'aftertake_refine_blend',
  'aftertake_generate_hosted_video',
  'aftertake_recover_hosted_video',
]);
const destructiveWrites = new Set([
  'aftertake_generation_action',
  'aftertake_character_action',
  'aftertake_cancel_finishing',
  'aftertake_depth_action',
  'aftertake_cancel_blend',
  'aftertake_cancel_hosted_video',
]);
const remoteTools = new Set([
  'aftertake_hosted_video_connection',
  'aftertake_estimate_hosted_video',
  'aftertake_generate_hosted_video',
  'aftertake_recover_hosted_video',
  'aftertake_cancel_hosted_video',
]);

export function toolAnnotations(name: string, readOnly: boolean) {
  return {
    readOnlyHint: readOnly,
    destructiveHint: !readOnly && destructiveWrites.has(name),
    idempotentHint: readOnly || idempotentWrites.has(name),
    openWorldHint: remoteTools.has(name),
  };
}
