import { z } from 'zod';

export const computeFeatures = [
  'structure',
  'inpaint',
  'cinema',
  'motion-transfer',
  'motion',
  'frame-edit',
  'image-gen',
  'text-video',
  'character-selection',
  'character-swap',
  'depth',
  'upscale',
  'interpolate',
  'song',
] as const;
/**
 * The engine's hardware preflight profile for each feature. Upscaling, frame
 * interpolation and songs run native diffusion or flow models on the GPU with no
 * LTX or H3 decoder contract, which the image profile checks.
 */
export function hardwareProfile(feature: (typeof computeFeatures)[number]) {
  return feature === 'upscale' || feature === 'interpolate' || feature === 'song'
    ? 'image-gen'
    : feature;
}

export type ComputeFeature = (typeof computeFeatures)[number];
/**
 * Workflows whose graphs use only nodes Comfy Cloud ships. Region effects,
 * motion transfer, frame edits, depth and character work need Aftertake's own
 * nodes or H3 Relay, so they always render on the local engine.
 */
export const cloudFeatures = ['image-gen', 'text-video', 'upscale', 'interpolate', 'song'] as const;
export type CloudFeature = (typeof cloudFeatures)[number];
/** The engine name a Comfy Cloud route reports in place of a GPU. */
export const comfyCloudEngine = 'Comfy Cloud';
export const cloudFeature = (feature: ComputeFeature): feature is CloudFeature =>
  (cloudFeatures as readonly string[]).includes(feature);
export type ComputeProvider = 'local' | 'comfy-cloud' | 'managed-deployment';

const apiKey = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .regex(/^[^\s\x00-\x1f\x7f]+$/);
const endpoint = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.run\.comfy\.app$/.test(url.hostname) &&
        !url.port &&
        url.pathname === '/' &&
        !url.username &&
        !url.password &&
        !/[?#]/.test(value) &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, 'Use an HTTPS *.run.comfy.app deployment origin without credentials, a port, path, query or fragment.')
  .transform((value) => new URL(value).toString().replace(/\/+$/, ''));

/** Input only. Never return or persist this object: it can contain a credential. */
export const computeConnectionSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('local') }).strict(),
  z.object({ provider: z.literal('comfy-cloud'), apiKey: apiKey.optional() }).strict(),
  z
    .object({ provider: z.literal('managed-deployment'), apiKey: apiKey.optional(), endpoint })
    .strict(),
]);
export type ComputeConnectionInput = z.infer<typeof computeConnectionSchema>;

export type ComputeCheck = {
  id: string;
  state: 'pass' | 'blocked' | 'unverified';
  message: string;
};
export type ComputeCapability = {
  feature: ComputeFeature;
  ready: boolean;
  message: string;
  /** Where a new job of this feature renders. */
  renders?: 'local' | 'comfy-cloud';
};

/** Public connection state contains credential presence only, never its value. */
export type ComputeStatus = {
  activeProvider: 'local' | 'comfy-cloud';
  configured: { provider: ComputeProvider; endpoint?: string; hasApiKey: boolean } | null;
  credentialStorage: 'memory';
  /** Cloud routing sends only the cloud features there; everything else stays local. */
  generationRouting: 'startup-local' | 'cloud-where-supported';
  state: 'local' | 'configured' | 'blocked' | 'cloud';
  ready: boolean;
  checkedAt: string | null;
  checks: ComputeCheck[];
  capabilities: ComputeCapability[];
  message: string;
};
