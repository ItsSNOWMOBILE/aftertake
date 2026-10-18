import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { templateNotes, type Template } from '../src/templates.js';
import { clipSchema, recipeSchema, type Clip, type Render } from '../src/domain.js';
import type { FrameEdit } from '../src/frame-edit.js';
import { imageRequestSchema, type ImageGeneration } from '../src/image-generation.js';
import {videoRequestSchema,videoDimensions,type VideoGeneration} from '../src/video-generation.js';
import {buildVideoWorkflow} from '../server/video-workflow.js';
import { inspectFramePng } from '../server/frame-edits.js';
import { isDeepStrictEqual } from 'node:util';
import type { DemoSnapshot } from '../src/demo-runtime.js';
import { inspectVideoMetadata,readVideoMetadata } from '../server/video-metadata.js';

export function buildDemoSnapshot(root: string, revision: string, options: { mediaBase?: string } = {}): DemoSnapshot {
  if (!/^[a-f0-9]{40,64}$/.test(revision)) throw Error('Choose a published immutable Git commit for example media.');
  const cache = new Map<string, Buffer>();
  function file(relative: string) {
    if (relative.startsWith('/') || relative.includes('\\') || relative.split('/').some(part => part === '..' || part === '.')) throw Error('Example paths must stay inside examples.');
    if (!cache.has(relative)) cache.set(relative, execFileSync('git', ['show', `${revision}:examples/${relative}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 }));
    return cache.get(relative)!;
  }
  const json = (relative: string) => JSON.parse(file(relative).toString('utf8'));
  const manifest = json('manifest.json');
  if (manifest.format !== 'aftertake-examples/1') throw Error('Unsupported example bundle.');
  const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
  const selectedBase = options.mediaBase ?? `https://raw.githubusercontent.com/ItsSNOWMOBILE/aftertake/${revision}/examples/`;
  const parsedBase = new URL(selectedBase, 'https://aftertake.invalid/');
  if (!selectedBase.trim() || selectedBase.includes('\\') || !['http:', 'https:'].includes(parsedBase.protocol) || parsedBase.username || parsedBase.password || parsedBase.search || parsedBase.hash)
    throw Error('Example media must use a relative path or a plain HTTP(S) base URL.');
  const base = selectedBase.endsWith('/') ? selectedBase : selectedBase + '/';
  const remote = (source: string) => base + source.split('/').map(encodeURIComponent).join('/');
  const media: Record<string, string> = {}, clips: Clip[] = [], frameEdits: FrameEdit[] = [], images: ImageGeneration[] = [],videos:VideoGeneration[]=[];
  const byTarget = new Map<string, { source: string; sha256: string; size: number }>();
  for (const item of manifest.files) {
    const bytes = file(item.source);
    if (bytes.length !== item.size || digest(bytes) !== item.sha256) throw Error(`Example checksum mismatch: ${item.source}`);
    byTarget.set(item.target, item);
    if (item.target.startsWith('clips/') && item.target.endsWith('.json')) clips.push(clipSchema.parse(JSON.parse(bytes.toString('utf8'))));
    if (item.target.startsWith('frame-edits/') && item.target.endsWith('.json')) frameEdits.push(JSON.parse(bytes.toString('utf8')));
    if (item.target.startsWith('images/') && item.target.endsWith('.json')) {
      const image = JSON.parse(bytes.toString('utf8')) as ImageGeneration;
      image.request = imageRequestSchema.parse(image.request); images.push(image);
    }
    if(item.target.startsWith('videos/')&&item.target.endsWith('.json')){
      const video=JSON.parse(bytes.toString('utf8'))as VideoGeneration;video.request=videoRequestSchema.parse(video.request);
      if(video.state!=='succeeded'||!video.clip)throw Error('Recorded text videos must have verified completed outputs.');
      videos.push(video);
    }
    if (item.target.startsWith('clips/') && !item.target.endsWith('.json')) media['/media/' + path.posix.basename(item.target)] = remote(item.source);
    if (item.target.startsWith('outputs/')) media['/' + item.target] = remote(item.source);
  }
  for(const video of videos){
    const clip=clips.find(c=>c.id===video.clip!.id),entry=byTarget.get('clips/'+path.posix.basename(video.clip!.url));
    if(!clip||!entry||!isDeepStrictEqual(clip,video.clip))throw Error('Recorded video has no matching source bytes.');
    const actual=readVideoMetadata(file(entry.source)),expected=buildVideoWorkflow(video.request),d=videoDimensions(video.request);
    if(!isDeepStrictEqual(actual.recipe,video.request)||!isDeepStrictEqual(actual.workflow,video.workflow)||
      clip.width!==d.width||clip.height!==d.height||Math.abs(clip.duration-d.duration)>1e-6||clip.hasAudio!==video.request.sound)
      throw Error('Recorded text video does not match its native request.');
    for(const[id,node]of Object.entries(expected))if(actual.workflow[id]?.class_type!==node.class_type||!isDeepStrictEqual(actual.workflow[id]?.inputs,node.inputs))throw Error('Recorded text-video graph differs from its request.');
  }
  const renders: Render[] = [], templates: Template[] = [];
  for (const item of manifest.cases) {
    const record = json(`${item.slug}/render.json`) as Render;
    record.recipe = recipeSchema.parse(record.recipe);
    record.workflow = inspectVideoMetadata(file(item.result), record.recipe).workflow;
    if (record.state !== 'succeeded' || !record.output) throw Error('Only completed recorded takes belong in the browser demo.');
    renders.push(record);
    if (!templateNotes[item.slug]) throw Error(`Missing example notes for ${item.slug}.`);
    templates.push({ ...item, ...templateNotes[item.slug], recipe: record.recipe,
      result: `/api/templates/${item.slug}/result`, source: `/api/templates/${item.slug}/source`, poster: `/api/templates/${item.slug}/poster`,
      ...(item.reference ? { reference: `/api/templates/${item.slug}/reference` } : {}), ...(item.frameRecipe ? { frameRecipe: `/api/templates/${item.slug}/frame-recipe` } : {}), ...(item.imageRecipe ? { imageRecipe: `/api/templates/${item.slug}/image-recipe` } : {}) });
    for (const key of ['result', 'source', 'poster', 'reference', 'frameRecipe', 'imageRecipe']) if (item[key])
      media[`/api/templates/${item.slug}/${key === 'frameRecipe' ? 'frame-recipe' : key === 'imageRecipe' ? 'image-recipe' : key}`] = remote(item[key]);
    if (item.imageRecipe) {
      const image = images.find(image => image.clip?.sha256 === record.recipe.clip.sha256);
      if (!image || !isDeepStrictEqual(inspectFramePng(file(item.source)).workflow, image.workflow)) throw Error('Image example must retain its executed PNG graph.');
    }
    if (item.frameRecipe) {
      const creation = json(item.frameRecipe);
      const edit = frameEdits.find(edit => edit.clip?.sha256 === creation.output?.sha256 && edit.request.clip.sha256 === record.recipe.clip.sha256);
      if (edit) media[`/api/frame-edits/${edit.id}/recipe`] = remote(item.frameRecipe);
    }
  }
  const thumbnails: DemoSnapshot['thumbnails'] = {};
  for (const clip of clips) {
    const choices: Record<string, string> = {};
    for (let tick = 0; tick <= Math.ceil(clip.duration * 24); tick++) {
      const time = clip.kind === 'image' ? 0 : tick / 24;
      const key = `previews/${digest(`thumbnail/1:${clip.sha256}:${time}`)}.jpg`;
      const item = byTarget.get(key);
      if (item) choices[tick] = remote(item.source);
      if (clip.kind === 'image') break;
    }
    if (!Object.keys(choices).length) throw Error(`Missing source thumbnails: ${clip.id}`);
    thumbnails[clip.id] = choices;
  }
  renders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { format: 'aftertake-browser-demo/1', mediaRevision: revision, clips, renders, frameEdits, images,videos, templates, media, thumbnails,
    workspace: { examples: true, exampleCount: templates.length, exampleNames: Object.fromEntries(manifest.cases.map((item: { renderId: string; title: string }) => [item.renderId, item.title])), featuredRenderId: manifest.featuredRenderId } };
}
