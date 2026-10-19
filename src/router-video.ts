import { z } from 'zod';
import type { Clip } from './domain';

export const routerVideoModel = 'ltx/ltx-2-5-fast' as const;

/** Hosted model inputs are separate from native Comfy workflow recipes. */
export const routerVideoRequestSchema = z
  .object({
    format: z.literal('aftertake-router-video/1'),
    name: z.string().trim().min(1).max(100),
    prompt: z.string().trim().min(5).max(3000),
    aspect: z.enum(['landscape', 'portrait']),
    seconds: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    sound: z.boolean(),
  })
  .strict();
export type RouterVideoRequest = z.infer<typeof routerVideoRequestSchema>;

export type RouterQuote =
  | {
      source: 'exact';
      currency: 'USD';
      amount: string;
      credits?: number;
      pricingAsOf?: string;
    }
  | {
      source: 'estimated';
      currency: 'USD';
      minAmount: string;
      maxAmount: string;
      pricingAsOf?: string;
    }
  | { source: 'unknown'; currency: 'USD'; reason: string };

export const routerTargetSchema = z
  .object({
    format: z.literal('aftertake-router-target/1'),
    provider: z.literal('comfy-router'),
    origin: z.literal('https://api.comfy.org'),
    model: z.literal(routerVideoModel),
    credentialFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type RouterTarget = z.infer<typeof routerTargetSchema>;

export const routerVideoStateSchema = z.enum([
  'submitting',
  'queued',
  'running',
  'canceling',
  'finalizing',
  'succeeded',
  'failed',
  'canceled',
  'submission_unknown',
  'connection_lost',
  'output_error',
]);
export type RouterVideoGeneration = {
  id: string;
  target: RouterTarget;
  request: RouterVideoRequest;
  requestKey?: string;
  requestDigest?: string;
  providerRequestId?: string;
  credentialFingerprint: string;
  state: z.infer<typeof routerVideoStateSchema>;
  createdAt: string;
  updatedAt: string;
  progress: number | null;
  stage?: string;
  error?: string;
  price?: RouterQuote;
  clip?: Clip;
};

export type RouterConnectionStatus = {
  admissionScope: string;
  configured: boolean;
  authenticated?: boolean;
  checkedAt?: string | null;
  model: typeof routerVideoModel;
  credentialStorage: 'memory';
  admissionIssue?: string;
};

export const routerVideoTerminal = new Set<RouterVideoGeneration['state']>([
  'succeeded',
  'failed',
  'canceled',
  'output_error',
]);
export const routerVideoBusy = (video: RouterVideoGeneration) =>
  !routerVideoTerminal.has(video.state);

export function routerVideoDimensions(request: Pick<RouterVideoRequest, 'aspect'>) {
  return request.aspect === 'portrait'
    ? { width: 720, height: 1280 }
    : { width: 1280, height: 720 };
}
