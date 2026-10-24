import { recipeSchema, type Clip, type Render } from './domain';
import type { FrameEdit } from './frame-edit';
import type { ImageGeneration } from './image-generation';
import type { VideoGeneration } from './video-generation';
import type { CharacterJob } from './character';
import type { OneTapJob, OneTapPreset } from './one-tap';
import type { StoryboardJob } from './storyboard';
import type { TakeSet } from './take-sets';
import type { Template } from './templates';
import { buildWorkflow } from '../server/workflow';

export type DemoSnapshot = {
  format: 'aftertake-browser-demo/1';
  mediaRevision: string;
  clips: Clip[];
  renders: Render[];
  frameEdits: FrameEdit[];
  images?: ImageGeneration[];
  videos?: VideoGeneration[];
  characters?: CharacterJob[];
  /** One-tap presets from presets/one-tap and the recorded effects made with them. */
  oneTap?: {
    presets: OneTapPreset[];
    music: { id: string; title: string; duration: number }[];
    jobs: OneTapJob[];
  };
  /** Recorded storyboards; their films play from the media map. */
  storyboards?: StoryboardJob[];
  /** Recorded sets of takes; each take is a record in its own studio's list. */
  takeSets?: TakeSet[];
  templates: Template[];
  media: Record<string, string>;
  thumbnails: Record<string, Record<string, string>>;
  workspace: {
    examples: true;
    exampleCount: number;
    exampleNames: Record<string, string>;
    featuredRenderId: string;
  };
};

export function createDemoRuntime(snapshot: DemoSnapshot) {
  if (snapshot.format !== 'aftertake-browser-demo/1') throw Error('Unsupported browser examples.');
  const data = structuredClone(snapshot);
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  function mediaUrl(value: string): string {
    if (value.startsWith('blob:')) return value;
    const url = new URL(value, 'https://aftertake.invalid');
    const thumbnail = url.pathname.match(/^\/api\/thumbnails\/([a-f0-9-]+)$/);
    if (thumbnail) {
      const clip = data.clips.find((item) => item.id === thumbnail[1]),
        choices = data.thumbnails[thumbnail[1]];
      if (!clip || !choices) return '';
      const requested = Number(url.searchParams.get('time')) || 0;
      const tick =
        clip.kind === 'image'
          ? 0
          : Math.round(Math.max(0, Math.min(clip.duration - 0.05, requested)) * 24);
      if (choices[tick]) return choices[tick];
      const nearest = Object.keys(choices)
        .map(Number)
        .sort((a, b) => Math.abs(a - tick) - Math.abs(b - tick))[0];
      return choices[nearest] || '';
    }
    return data.media[url.pathname] || '';
  }
  async function request(value: string, init?: RequestInit): Promise<Response> {
    const path = new URL(value, 'https://aftertake.invalid').pathname,
      method = (init?.method || 'GET').toUpperCase();
    if (method === 'GET') {
      if (path === '/api/engine')
        return json({
          connected: false,
          ready: false,
          missing: [],
          message: 'Browser demo · recorded examples',
        });
      if (path === '/api/workspace') return json(data.workspace);
      if (path === '/api/clips') return json(data.clips);
      if (path === '/api/renders') return json(data.renders);
      if (path === '/api/frame-edits') return json(data.frameEdits);
      if (path === '/api/templates') return json(data.templates);
      if (path === '/api/films') return json([]);
      if (path === '/api/images') return json(data.images || []);
      if (path === '/api/videos') return json(data.videos || []);
      if (path === '/api/characters') return json(data.characters || []);
      if (path === '/api/one-tap/presets')
        return json({
          presets: data.oneTap?.presets || [],
          music: data.oneTap?.music || [],
          problems: [],
        });
      if (path === '/api/one-tap') return json(data.oneTap?.jobs || []);
      if (path === '/api/storyboards') return json(data.storyboards || []);
      if (path === '/api/take-sets') return json(data.takeSets || []);
      const effect = path.match(/^\/api\/one-tap\/([a-f0-9-]+)$/);
      if (effect) {
        const job = data.oneTap?.jobs.find((item) => item.id === effect[1]);
        return job ? json(job) : json({ error: 'Recorded effect not found.' }, 404);
      }
      const character = path.match(/^\/api\/characters\/([a-f0-9-]+)$/);
      if (character) {
        const job = data.characters?.find((item) => item.id === character[1]);
        return job ? json(job) : json({ error: 'Recorded character take not found.' }, 404);
      }
      const render = path.match(/^\/api\/renders\/([a-f0-9-]+)$/);
      if (render)
        return data.renders.some((item) => item.id === render[1])
          ? json(data.renders.find((item) => item.id === render[1]))
          : json({ error: 'Recorded take not found.' }, 404);
    }
    if (method === 'POST' && path === '/api/workflow') {
      try {
        return json(buildWorkflow(recipeSchema.parse(JSON.parse(String(init?.body || 'null')))));
      } catch {
        return json({ error: 'Choose a valid source, direction and cue before exporting.' }, 422);
      }
    }
    const open = path.match(/^\/api\/templates\/([a-z0-9-]+)\/open$/);
    if (method === 'POST' && open) {
      const template = data.templates.find((item) => item.slug === open[1]);
      const render = data.renders.find((item) => item.id === template?.renderId);
      return render
        ? json({ render, clip: render.recipe.clip })
        : json({ error: 'Recorded example not found.' }, 404);
    }
    return json(
      {
        error:
          'This browser demo edits recorded examples. Run Aftertake locally to import media, generate new takes, track motion or export a film.',
      },
      409,
    );
  }
  return { request, mediaUrl };
}
