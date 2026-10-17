import { recipeSchema, type Clip, type Render } from './domain';
import type { FrameEdit } from './frame-edit';
import type { Template } from './templates';
import { buildWorkflow } from '../server/workflow';

export type DemoSnapshot = {
  format: 'aftertake-browser-demo/1'; mediaRevision: string;
  clips: Clip[]; renders: Render[]; frameEdits: FrameEdit[]; templates: Template[];
  media: Record<string, string>; thumbnails: Record<string, Record<string, string>>;
  workspace: { examples: true; exampleCount: number; exampleNames: Record<string, string>; featuredRenderId: string };
};

export function createDemoRuntime(snapshot: DemoSnapshot) {
  if (snapshot.format !== 'aftertake-browser-demo/1') throw Error('Unsupported browser examples.');
  const data = structuredClone(snapshot);
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  function mediaUrl(value: string): string {
    if (value.startsWith('blob:')) return value;
    const url = new URL(value, 'https://aftertake.invalid');
    const thumbnail = url.pathname.match(/^\/api\/thumbnails\/([a-f0-9-]+)$/);
    if (thumbnail) {
      const clip = data.clips.find(item => item.id === thumbnail[1]), choices = data.thumbnails[thumbnail[1]];
      if (!clip || !choices) return '';
      const requested = Number(url.searchParams.get('time')) || 0;
      const tick = clip.kind === 'image' ? 0 : Math.round(Math.max(0, Math.min(clip.duration - .05, requested)) * 24);
      if (choices[tick]) return choices[tick];
      const nearest = Object.keys(choices).map(Number).sort((a, b) => Math.abs(a - tick) - Math.abs(b - tick))[0];
      return choices[nearest] || '';
    }
    return data.media[url.pathname] || '';
  }
  async function request(value: string, init?: RequestInit): Promise<Response> {
    const path = new URL(value, 'https://aftertake.invalid').pathname, method = (init?.method || 'GET').toUpperCase();
    if (method === 'GET') {
      if (path === '/api/engine') return json({ connected: false, ready: false, missing: [], message: 'Browser demo · recorded examples' });
      if (path === '/api/workspace') return json(data.workspace);
      if (path === '/api/clips') return json(data.clips);
      if (path === '/api/renders') return json(data.renders);
      if (path === '/api/frame-edits') return json(data.frameEdits);
      if (path === '/api/templates') return json(data.templates);
      if (path === '/api/films') return json([]);
      const render = path.match(/^\/api\/renders\/([a-f0-9-]+)$/);
      if (render) return data.renders.some(item => item.id === render[1]) ? json(data.renders.find(item => item.id === render[1])) : json({ error: 'Recorded take not found.' }, 404);
    }
    if (method === 'POST' && path === '/api/workflow') {
      try { return json(buildWorkflow(recipeSchema.parse(JSON.parse(String(init?.body || 'null'))))); }
      catch { return json({ error: 'Choose a valid source, direction and cue before exporting.' }, 422); }
    }
    const open = path.match(/^\/api\/templates\/([a-z0-9-]+)\/open$/);
    if (method === 'POST' && open) {
      const template = data.templates.find(item => item.slug === open[1]);
      const render = data.renders.find(item => item.id === template?.renderId);
      return render ? json({ render, clip: render.recipe.clip }) : json({ error: 'Recorded example not found.' }, 404);
    }
    return json({ error: 'This browser demo edits recorded examples. Run Aftertake locally to import media, generate new takes, track motion or export a film.' }, 409);
  }
  return { request, mediaUrl };
}
