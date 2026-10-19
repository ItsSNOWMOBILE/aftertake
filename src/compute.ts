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
] as const;

export type ComputeFeature = (typeof computeFeatures)[number];
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
};

/** Public connection state contains credential presence only, never its value. */
export type ComputeStatus = {
  activeProvider: 'local';
  configured: { provider: ComputeProvider; endpoint?: string; hasApiKey: boolean } | null;
  credentialStorage: 'memory';
  generationRouting: 'startup-local';
  state: 'local' | 'configured' | 'blocked';
  ready: boolean;
  checkedAt: string | null;
  checks: ComputeCheck[];
  capabilities: ComputeCapability[];
  message: string;
};
