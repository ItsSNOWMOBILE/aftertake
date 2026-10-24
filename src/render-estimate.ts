/**
 * How long a job will take before you start it: the local equivalent of a price
 * before rendering. Earlier runs in this workspace come first; without them the
 * estimate falls back to times recorded on an RTX 5080 for the shipped examples.
 */
import { comfyCloudEngine } from './compute';

type Request = {
  format?: string;
  quality?: string;
  resolution?: string;
  mode?: string;
  operation?: string;
  timing?: string;
  multiplier?: number;
};
type Recipe = {
  pipeline?: string;
  quality: string;
  resolution?: string;
  transfer?: { finish?: unknown };
};
/** Any stored job: a generation, frame edit or character job carries a request, a take carries a recipe. */
export type TimedJob = {
  state: string;
  createdAt: string;
  updatedAt: string;
  request?: Request;
  recipe?: Recipe;
  /** A recomposition reuses a saved generation, so its time says nothing about rendering. */
  recomposition?: unknown;
  /** Mask repair and foreground protection are post-processing of an earlier job, not a new generation. */
  repair?: unknown;
  protection?: unknown;
};

const hd = (resolution?: string) => (resolution === '720p' ? '-720p' : '');

/** The settings that decide how long a job takes, as a short key; null when it is not timed. */
export function estimateKey(job: Pick<TimedJob, 'request' | 'recipe'>): string | null {
  if (job.recipe) {
    const recipe = job.recipe;
    // Compositing a saved generation is CPU finishing that takes seconds.
    if (recipe.transfer?.finish) return null;
    return `take:${recipe.pipeline || 'structure'}:${recipe.quality}${hd(recipe.resolution)}`;
  }
  const request = job.request;
  switch (request?.format) {
    case 'aftertake-text-video/1':
      return `video:${request.quality}${hd(request.resolution)}`;
    case 'aftertake-image/1':
      return `image${hd(request.resolution)}`;
    case 'aftertake-frame-edit/1':
      return `frame:${request.mode}`;
    case 'aftertake-character-selection/1':
      return 'character-selection';
    case 'aftertake-character/1':
      return 'character';
    case 'aftertake-enhance/1':
      return request.operation === 'upscale'
        ? 'enhance:upscale'
        : `enhance:${request.timing}-x${request.multiplier}`;
    case 'aftertake-song/1':
      return 'song';
    default:
      return null;
  }
}

/** Seconds from admission to the final update, for a job that finished and rendered. */
export function elapsedSeconds(job: TimedJob): number | null {
  if (job.state !== 'succeeded' || job.recomposition || job.repair || job.protection) return null;
  const seconds = (Date.parse(job.updatedAt) - Date.parse(job.createdAt)) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/**
 * Elapsed seconds of the shipped example jobs on an RTX 5080 (16 GB) with a Core Ultra 9
 * 285K, model loading included. tests/render-estimate.test.ts recomputes this table from
 * the example records, so it cannot drift from them.
 */
export const referenceSeconds: Record<string, number[]> = {
  'video:draft': [62, 83],
  'video:final': [84],
  'video:final-720p': [117, 117, 119, 120, 120, 122, 123, 123, 123, 125, 125, 125, 126, 134],
  image: [10, 10, 10, 10],
  'image-720p': [24, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 30, 30, 37, 44, 45],
  'frame:fast': [39, 39, 47, 47, 47],
  'frame:detail': [148, 199],
  'take:cinema:final': [73, 83, 83, 85, 89, 91],
  'take:cinema:final-720p': [101, 102, 102, 102, 103, 104, 104, 104, 105, 107, 543],
  'take:inpaint:final': [96, 100, 102, 107, 108, 112, 118],
  'take:inpaint:final-720p': [206],
  'take:motion-transfer:final': [137, 140, 195, 196, 197, 296],
  'take:motion-transfer:final-720p': [3142],
  'character-selection': [14, 17, 21, 31, 39, 288],
  character: [214, 328, 376, 381, 630, 678, 716],
  'enhance:slow-motion-x4': [10],
  'enhance:smooth-x2': [6],
  song: [8, 14],
  'enhance:upscale': [390],
};
export const referenceGpu = 'RTX 5080';

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b),
    middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export type RenderEstimate = {
  seconds: number;
  runs: number;
  from: 'workspace' | 'reference';
};

/** The median time of matching earlier runs here, else of the RTX 5080 reference runs. */
export function estimate(key: string | null, history: TimedJob[]): RenderEstimate | null {
  if (!key) return null;
  const local = history.flatMap((job) => {
    const seconds = estimateKey(job) === key ? elapsedSeconds(job) : null;
    return seconds === null ? [] : [seconds];
  });
  if (local.length) return { seconds: median(local), runs: local.length, from: 'workspace' };
  const reference = referenceSeconds[key];
  return reference?.length
    ? { seconds: median(reference), runs: reference.length, from: 'reference' }
    : null;
}

/** A rounded duration that does not promise more precision than the runs support. */
export function formatDuration(seconds: number) {
  if (seconds < 50) return `${Math.max(5, Math.round(seconds / 5) * 5)} s`;
  if (seconds < 600) {
    const halves = Math.max(2, Math.round(seconds / 30)),
      whole = Math.floor(halves / 2);
    return `${whole}${halves % 2 ? '½' : ''} min`;
  }
  if (seconds < 3300) return `${Math.round(seconds / 300) * 5} min`;
  const hours = Math.round(seconds / 1800) / 2;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/** The time and where it comes from, for beside a render button; null when nothing is known. */
export function describeEstimate(value: RenderEstimate | null, gpu?: string) {
  if (gpu === comfyCloudEngine)
    return {
      time: 'Renders on Comfy Cloud · uses your credits',
      basis: "Time depends on Comfy Cloud's queue",
    };
  if (!value) return null;
  const time = `About ${formatDuration(value.seconds)} · free on your own GPU`;
  if (value.from === 'workspace')
    return {
      time,
      basis: `${value.runs === 1 ? 'From 1 earlier run' : `Median of ${value.runs} runs`} in this workspace`,
    };
  const other = gpu && !gpu.includes('5080');
  return { time, basis: `Measured on an ${referenceGpu}${other ? '; yours may differ' : ''}` };
}

/** The estimate for an agent: whole seconds, what they rest on, and the cost. */
export function agentEstimate(value: RenderEstimate | null, onCloud = false) {
  return (
    value && {
      seconds: Math.round(value.seconds),
      basis: `${
        value.from === 'workspace'
          ? `median of ${value.runs} earlier runs in this workspace`
          : `median of ${value.runs} runs recorded on an ${referenceGpu}`
      }${onCloud ? "; Comfy Cloud's time depends on its queue" : ''}`,
      cost: onCloud
        ? 'Comfy Cloud credits on the connected account'
        : 'none: it runs on the local GPU',
    }
  );
}

/** Each kind of job the filter keeps, with its estimate, so an agent can plan its time. */
export function estimateTable(history: TimedJob[], keep: (key: string) => boolean) {
  const keys = new Set(
    [...Object.keys(referenceSeconds), ...history.map(estimateKey)].filter(
      (key): key is string => !!key && keep(key),
    ),
  );
  return Object.fromEntries(
    [...keys].sort().map((key) => [key, agentEstimate(estimate(key, history))]),
  );
}
