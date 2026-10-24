import { z } from 'zod';
import {
  storyboardPlanRequestSchema,
  storyboardRequestSchema,
  storyboardRenders,
  type StoryboardJob,
  type StoryboardPlan,
} from '../src/storyboard.js';

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

/** Storyboards for agents: plan the shots, render the film, follow it. */
export function registerStoryboardTools({
  tool,
  api,
  base,
}: {
  tool: Register;
  api: <T = any>(route: string, body?: unknown, key?: string) => Promise<T>;
  base: string;
}) {
  const summary = (job: StoryboardJob) => ({
    id: job.id,
    title: job.request.title,
    state: job.state,
    stage: job.stage,
    progress: job.progress,
    error: job.error,
    requestKey: job.requestKey,
    shots: job.shots.map((shot, index) => ({
      prompt: job.request.shots[index].prompt,
      videoId: shot.videoId,
      clipId: shot.clip?.id,
    })),
    songId: job.song?.enhancementId,
    filmId: job.filmId,
    video: job.state === 'ready' ? `${base}/api/storyboards/${job.id}/video` : undefined,
    project: job.state === 'ready' ? job.draft : undefined,
  });
  tool(
    'aftertake_plan_storyboard',
    'Plan a 3–5 shot list from one idea: a title, a shared look and per shot a visual prompt, one of the camera moves and 3–5 seconds. Uses the local Qwen3-4B on the CPU when it is installed, otherwise a template; the planner field says which. Edit the plan before making the film. Starts no GPU work.',
    storyboardPlanRequestSchema,
    async (input) => ({ data: await api<StoryboardPlan>('/api/storyboards/plan', input) }),
    true,
  );
  tool(
    'aftertake_make_storyboard',
    'Make a storyboard film: each shot renders with Create video (LTX-2.5), ACE-Step composes the song from style tags, and Film cuts the shots on the song’s beats with titles and transitions. Starts one render per shot plus the song. A stable requestId rejoins the same storyboard.',
    z.object({ requestId, request: storyboardRequestSchema }),
    async (input) => {
      const job = await api<StoryboardJob>('/api/storyboards', input.request, input.requestId);
      return { data: { ...summary(job), renders: storyboardRenders(input.request) } };
    },
    false,
  );
  tool(
    'aftertake_storyboard_status',
    'Read a storyboard by record ID or stable requestId: its stage, each shot’s Create video job, the song, and when ready the film URL and the editable Film project (save it with aftertake_save_film_edit to keep editing).',
    z
      .object({ id: z.string().uuid().optional(), requestId: requestId.optional() })
      .refine(
        (value) => Boolean(value.id) !== Boolean(value.requestId),
        'Choose exactly one ID or requestId.',
      ),
    async (input) => {
      const job = input.id
        ? await api<StoryboardJob>(`/api/storyboards/${input.id}`)
        : (await api<StoryboardJob[]>('/api/storyboards')).find(
            (item) => item.requestKey === input.requestId,
          );
      if (!job) throw Error('No storyboard matches this request.');
      return { data: summary(job) };
    },
  );
}
