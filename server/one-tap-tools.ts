import { z } from 'zod';
import {
  oneTapDuration,
  oneTapRequestSchema,
  type OneTapJob,
  type OneTapPreset,
} from '../src/one-tap.js';

type Register = (
  name: string,
  description: string,
  schema: z.ZodType,
  run: (input: any) => Promise<{ data: unknown }>,
  readOnly?: boolean,
) => void;
const requestId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);

/** One-tap effects for agents: list the presets, start one, follow it, change its watermark. */
export function registerOneTapTools({
  tool,
  api,
  base,
}: {
  tool: Register;
  api: <T = any>(route: string, body?: unknown, key?: string) => Promise<T>;
  base: string;
}) {
  const summary = (job: OneTapJob) => ({
    id: job.id,
    preset: job.preset.id,
    state: job.state,
    stage: job.stage,
    progress: job.progress,
    error: job.error,
    requestKey: job.requestKey,
    attempts: job.attempts.map((attempt) => ({
      seed: attempt.seed,
      renderId: attempt.renderId,
      checks: attempt.check && { ok: attempt.check.ok, problems: attempt.check.problems },
    })),
    watermark: job.watermark,
    video:
      job.state === 'ready'
        ? `${base}/api/one-tap/${job.id}/video?watermark=${job.watermark ? 1 : 0}`
        : undefined,
    films: Object.fromEntries(
      Object.entries(job.exports).map(([variant, cut]) => [variant, cut?.filmId]),
    ),
  });
  tool(
    'aftertake_one_tap_effects',
    'List the one-tap effect presets: each turns one photo (or a frame of a clip) into a finished 9:16 clip with an Animate a frame camera move on LTX-2.5, an automatic output check, then a Film cut with titles, a transition, an ACE-Step song and an optional Aftertake watermark. Presets are JSON files in presets/one-tap; files that fail validation are listed under problems.',
    z.object({}),
    async () => {
      const library = await api<{
        presets: OneTapPreset[];
        music: { id: string; title: string }[];
        problems: unknown[];
      }>('/api/one-tap/presets');
      return {
        data: {
          presets: library.presets.map((preset) => ({
            id: preset.id,
            title: preset.title,
            line: preset.line,
            accepts: preset.accepts,
            seconds: oneTapDuration(preset),
            move: preset.motion.movement,
            editableTitle: preset.titles.find((title) => title.editable)?.text,
            song: library.music.find((song) => song.id === preset.music?.track)?.title,
          })),
          problems: library.problems,
          workflow: [
            'Import or choose a photo clip (aftertake_import_media or the studio), then start an effect with its clip ID.',
            'One render runs at a time. A take that is blank, frozen or the wrong length renders once more with a new seed.',
            'Poll aftertake_one_tap_status until ready, then fetch the video URL. Switching the watermark re-cuts on the CPU only.',
            'Run it again with another seed for a different take; the same requestId rejoins the same effect.',
          ],
        },
      };
    },
  );
  tool(
    'aftertake_make_one_tap_effect',
    'Start a one-tap effect on a photo or video clip in the studio workspace. Uses the GPU once, plus one automatic re-render if the output check fails. A stable requestId rejoins the same effect instead of starting another.',
    z.object({ requestId, request: oneTapRequestSchema }),
    async (input) => ({
      data: summary(await api<OneTapJob>('/api/one-tap', input.request, input.requestId)),
    }),
    false,
  );
  tool(
    'aftertake_one_tap_status',
    'Read a one-tap effect by record ID or stable requestId: its stage, check results per take, and the finished video URL when ready.',
    z
      .object({ id: z.string().uuid().optional(), requestId: requestId.optional() })
      .refine(
        (value) => Boolean(value.id) !== Boolean(value.requestId),
        'Choose exactly one ID or requestId.',
      ),
    async (input) => {
      const job = input.id
        ? await api<OneTapJob>(`/api/one-tap/${input.id}`)
        : (await api<OneTapJob[]>('/api/one-tap')).find(
            (item) => item.requestKey === input.requestId,
          );
      if (!job) throw Error('No one-tap effect matches this request.');
      return { data: summary(job) };
    },
  );
  tool(
    'aftertake_one_tap_watermark',
    'Show a finished one-tap effect with or without the small Aftertake watermark. Re-cuts the Film on the CPU once per choice; never renders on the GPU.',
    z.object({ id: z.string().uuid(), watermark: z.boolean() }),
    async (input) => ({
      data: summary(
        await api<OneTapJob>(`/api/one-tap/${input.id}/export`, { watermark: input.watermark }),
      ),
    }),
    false,
  );
}
