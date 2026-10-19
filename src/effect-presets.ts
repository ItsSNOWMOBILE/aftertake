import { z } from 'zod';
import { subjectEffectRequestSchema, type SubjectEffectRequest } from './subject-effects';
import {
  depthSettingsSchema,
  defaultDepthSettings,
  type DepthEffectRequest,
} from './depth-effects';

const presetIdentity = {
  id: z.string().regex(/^[a-z][a-z0-9-]+$/),
  label: z.string().min(1).max(60),
  description: z.string().min(1).max(240),
};
const subjectSettingsSchema = subjectEffectRequestSchema
  .pick({
    copies: true,
    feather: true,
    grow: true,
    backgroundBlur: true,
    backgroundExposureEV: true,
  })
  .required();
export const subjectEffectPresetSchema = z
  .object({ ...presetIdentity, settings: subjectSettingsSchema })
  .strict();
export const depthEffectPresetSchema = z
  .object({ ...presetIdentity, settings: depthSettingsSchema })
  .strict();
export type SubjectEffectPreset = z.infer<typeof subjectEffectPresetSchema>;
export type DepthEffectPreset = z.infer<typeof depthEffectPresetSchema>;

function subjectPreset(value: SubjectEffectPreset) {
  const preset = subjectEffectPresetSchema.parse(value);
  preset.settings.copies.forEach(Object.freeze);
  Object.freeze(preset.settings.copies);
  Object.freeze(preset.settings);
  return Object.freeze(preset);
}
function depthPreset(value: DepthEffectPreset) {
  const preset = depthEffectPresetSchema.parse(value);
  Object.freeze(preset.settings);
  return Object.freeze(preset);
}
const copy = (x: number, opacity = 1, flipX = false) => ({
  x,
  y: 0,
  scale: 1,
  opacity,
  flipX,
  rotation: 0,
});
const subjectDefaults = { feather: 2, grow: 0, backgroundBlur: 0, backgroundExposureEV: 0 };

export const subjectEffectPresets = Object.freeze([
  subjectPreset({
    id: 'three-person-ensemble',
    label: 'Three-person ensemble',
    description:
      'Two opaque copies at −28% and +28% of the canvas, with the right copy mirrored. Leave space on both sides.',
    settings: { ...subjectDefaults, copies: [copy(-0.28), copy(0.28, 1, true)] },
  }),
  subjectPreset({
    id: 'mirror-partner',
    label: 'Mirror partner',
    description: 'One mirrored copy 28% to the right. The original performance stays in place.',
    settings: { ...subjectDefaults, copies: [copy(0.28, 1, true)] },
  }),
  subjectPreset({
    id: 'translucent-copies',
    label: 'Translucent copies',
    description:
      'Two 35%-opacity spatial copies beside the original. All copies show the same frame, without a time delay.',
    settings: { ...subjectDefaults, copies: [copy(-0.18, 0.35), copy(0.18, 0.35)] },
  }),
  subjectPreset({
    id: 'background-focus',
    label: 'Background focus',
    description:
      'Keep the tracked person sharp and add 10px blur with slightly darker exposure behind the mask. No extra copies.',
    settings: { ...subjectDefaults, copies: [], backgroundBlur: 10, backgroundExposureEV: -0.35 },
  }),
  subjectPreset({
    id: 'subtle-focus',
    label: 'Subtle focus',
    description:
      'A lighter 4px background blur and small exposure reduction around the original tracked person. No extra copies.',
    settings: { ...subjectDefaults, copies: [], backgroundBlur: 4, backgroundExposureEV: -0.1 },
  }),
]);

export const depthEffectPresets = Object.freeze([
  depthPreset({
    id: 'natural-depth-focus',
    label: 'Natural depth focus',
    description:
      'Still image: conservative 6px depth blur around a near focus plane. Adjust Focus depth to match your subject.',
    settings: { ...defaultDepthSettings, blur: 6 },
  }),
  depthPreset({
    id: 'soft-atmosphere',
    label: 'Soft atmosphere',
    description: 'Still image: a restrained cool haze toward the far depth with light 2px blur.',
    settings: { ...defaultDepthSettings, blur: 2, haze: 0.18 },
  }),
  depthPreset({
    id: 'directional-depth-light',
    label: 'Directional depth light',
    description:
      'Still image: subtle directional light from approximate depth normals. It does not reconstruct physical shadows.',
    settings: { ...defaultDepthSettings, lightStrength: 0.18 },
  }),
]);

export function applySubjectEffectPreset(
  request: SubjectEffectRequest,
  id: string,
): SubjectEffectRequest {
  const preset = subjectEffectPresets.find((item) => item.id === id);
  if (!preset) throw new Error('Unknown subject-effect preset.');
  // Presets contain editable effect parameters only. Keep every source binding
  // and the user's name, and give each edit its own mutable copy of settings.
  return { ...request, ...structuredClone(preset.settings) };
}
export function applyDepthEffectPreset(
  request: DepthEffectRequest,
  id: string,
): DepthEffectRequest {
  const preset = depthEffectPresets.find((item) => item.id === id);
  if (!preset) throw new Error('Unknown depth-effect preset.');
  return { ...request, settings: structuredClone(preset.settings) };
}
export function matchingSubjectEffectPreset(request?: SubjectEffectRequest) {
  if (!request) return;
  const settings = subjectSettingsSchema.parse({
    copies: request.copies.map((item) => ({
      ...item,
      flipX: item.flipX ?? false,
      rotation: item.rotation ?? 0,
    })),
    feather: request.feather ?? 0,
    grow: request.grow ?? 0,
    backgroundBlur: request.backgroundBlur ?? 0,
    backgroundExposureEV: request.backgroundExposureEV ?? 0,
  });
  return subjectEffectPresets.find(
    (item) => JSON.stringify(item.settings) === JSON.stringify(settings),
  );
}
export function matchingDepthEffectPreset(settings: DepthEffectRequest['settings']) {
  const normalized = depthSettingsSchema.parse(settings);
  return depthEffectPresets.find(
    (item) => JSON.stringify(item.settings) === JSON.stringify(normalized),
  );
}
