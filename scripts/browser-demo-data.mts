import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { oneTapMusicSchema, oneTapPresetSchema, type OneTapJob } from '../src/one-tap.js';
import type { StoryboardJob } from '../src/storyboard.js';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { templateNotes, type Template } from '../src/templates.js';
import { clipSchema, recipeSchema, type Clip, type Render } from '../src/domain.js';
import type { FrameEdit } from '../src/frame-edit.js';
import { imageRequestSchema, type ImageGeneration } from '../src/image-generation.js';
import {
  videoRequestSchema,
  videoDimensions,
  type VideoGeneration,
} from '../src/video-generation.js';
import { buildVideoWorkflow } from '../server/video-workflow.js';
import { inspectFramePng } from '../server/frame-edits.js';
import { isDeepStrictEqual } from 'node:util';
import type { DemoSnapshot } from '../src/demo-runtime.js';
import { inspectVideoMetadata, readVideoMetadata } from '../server/video-metadata.js';
import {
  characterRequestSchema,
  characterSelectionSchema,
  parseCharacterSelectionInfo,
  type CharacterJob,
} from '../src/character.js';

export function buildDemoSnapshot(
  root: string,
  revision: string,
  options: { mediaBase?: string } = {},
): DemoSnapshot {
  if (!/^[a-f0-9]{40,64}$/.test(revision))
    throw Error('Choose a published immutable Git commit for example media.');
  const cache = new Map<string, Buffer>();
  function file(relative: string) {
    if (
      relative.startsWith('/') ||
      relative.includes('\\') ||
      relative.split('/').some((part) => part === '..' || part === '.')
    )
      throw Error('Example paths must stay inside examples.');
    if (!cache.has(relative))
      cache.set(
        relative,
        execFileSync('git', ['show', `${revision}:examples/${relative}`], {
          cwd: root,
          maxBuffer: 64 * 1024 * 1024,
        }),
      );
    return cache.get(relative)!;
  }
  const json = (relative: string) => JSON.parse(file(relative).toString('utf8'));
  const manifest = json('manifest.json');
  if (manifest.format !== 'aftertake-examples/1') throw Error('Unsupported example bundle.');
  const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
  const selectedBase =
    options.mediaBase ??
    `https://raw.githubusercontent.com/ItsSNOWMOBILE/aftertake/${revision}/examples/`;
  const parsedBase = new URL(selectedBase, 'https://aftertake.invalid/');
  if (
    !selectedBase.trim() ||
    selectedBase.includes('\\') ||
    !['http:', 'https:'].includes(parsedBase.protocol) ||
    parsedBase.username ||
    parsedBase.password ||
    parsedBase.search ||
    parsedBase.hash
  )
    throw Error('Example media must use a relative path or a plain HTTP(S) base URL.');
  const base = selectedBase.endsWith('/') ? selectedBase : selectedBase + '/';
  const remote = (source: string) => base + source.split('/').map(encodeURIComponent).join('/');
  const media: Record<string, string> = {},
    clips: Clip[] = [],
    frameEdits: FrameEdit[] = [],
    images: ImageGeneration[] = [],
    videos: VideoGeneration[] = [],
    oneTapJobs: OneTapJob[] = [],
    storyboards: StoryboardJob[] = [];
  const byTarget = new Map<string, { source: string; sha256: string; size: number }>();
  for (const item of manifest.files) {
    const bytes = file(item.source);
    if (bytes.length !== item.size || digest(bytes) !== item.sha256)
      throw Error(`Example checksum mismatch: ${item.source}`);
    byTarget.set(item.target, item);
    if (item.target.startsWith('clips/') && item.target.endsWith('.json'))
      clips.push(clipSchema.parse(JSON.parse(bytes.toString('utf8'))));
    if (item.target.startsWith('frame-edits/') && item.target.endsWith('.json'))
      frameEdits.push(JSON.parse(bytes.toString('utf8')));
    if (item.target.startsWith('images/') && item.target.endsWith('.json')) {
      const image = JSON.parse(bytes.toString('utf8')) as ImageGeneration;
      image.request = imageRequestSchema.parse(image.request);
      images.push(image);
    }
    if (item.target.startsWith('videos/') && item.target.endsWith('.json')) {
      const video = JSON.parse(bytes.toString('utf8')) as VideoGeneration;
      video.request = videoRequestSchema.parse(video.request);
      if (video.state !== 'succeeded' || !video.clip)
        throw Error('Recorded text videos must have verified completed outputs.');
      videos.push(video);
    }
    if (item.target.startsWith('clips/') && !item.target.endsWith('.json'))
      media['/media/' + path.posix.basename(item.target)] = remote(item.source);
    if (item.target.startsWith('outputs/')) media['/' + item.target] = remote(item.source);
    if (item.target.startsWith('one-tap/') && item.target.endsWith('.json'))
      oneTapJobs.push(JSON.parse(bytes.toString('utf8')));
    if (/^storyboards\/[a-f0-9-]{36}\.json$/.test(item.target))
      storyboards.push(JSON.parse(bytes.toString('utf8')));
  }
  for (const job of storyboards) {
    const cut = job.filmId && byTarget.get(`films/${job.filmId}.mp4`);
    if (job.state !== 'ready' || !cut) throw Error('A recorded storyboard has no finished film.');
    media[`/api/storyboards/${job.id}/video`] = remote(cut.source);
  }
  for (const job of oneTapJobs) {
    const cut = job.exports.watermark && byTarget.get(`films/${job.exports.watermark.filmId}.mp4`);
    if (job.state !== 'ready' || !cut) throw Error('A recorded effect has no finished clip.');
    media[`/api/one-tap/${job.id}/video`] = remote(cut.source);
  }
  // Presets are data files beside the code, so the trial shows the gallery this build ships.
  const presetFolder = (name: string) =>
    readdirSync(path.join(root, 'presets', name))
      .filter((file) => file.endsWith('.json'))
      .map((file) => JSON.parse(readFileSync(path.join(root, 'presets', name, file), 'utf8')));
  const oneTap = {
    presets: presetFolder('one-tap')
      .map((value) => oneTapPresetSchema.parse(value))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    music: presetFolder('music').map((value) => {
      const { id, title, duration } = oneTapMusicSchema.parse(value);
      return { id, title, duration };
    }),
    jobs: oneTapJobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
  for (const video of videos) {
    const clip = clips.find((c) => c.id === video.clip!.id),
      entry = byTarget.get('clips/' + path.posix.basename(video.clip!.url));
    if (!clip || !entry || !isDeepStrictEqual(clip, video.clip))
      throw Error('Recorded video has no matching source bytes.');
    const actual = readVideoMetadata(file(entry.source)),
      expected = buildVideoWorkflow(video.request),
      d = videoDimensions(video.request);
    if (
      !isDeepStrictEqual(actual.recipe, video.request) ||
      !isDeepStrictEqual(actual.workflow, video.workflow) ||
      clip.width !== d.width ||
      clip.height !== d.height ||
      Math.abs(clip.duration - d.duration) > 1e-6 ||
      clip.hasAudio !== video.request.sound
    )
      throw Error('Recorded text video does not match its native request.');
    for (const [id, node] of Object.entries(expected))
      if (
        actual.workflow[id]?.class_type !== node.class_type ||
        !isDeepStrictEqual(actual.workflow[id]?.inputs, node.inputs)
      )
        throw Error('Recorded text-video graph differs from its request.');
  }
  const renders: Render[] = [],
    templates: Template[] = [];
  for (const item of manifest.cases) {
    const record = json(`${item.slug}/render.json`) as Render;
    record.recipe = recipeSchema.parse(record.recipe);
    record.workflow = inspectVideoMetadata(file(item.result), record.recipe).workflow;
    if (record.state !== 'succeeded' || !record.output)
      throw Error('Only completed recorded takes belong in the browser demo.');
    renders.push(record);
    if (!templateNotes[item.slug]) throw Error(`Missing example notes for ${item.slug}.`);
    templates.push({
      ...item,
      ...templateNotes[item.slug],
      recipe: record.recipe,
      result: `/api/templates/${item.slug}/result`,
      source: `/api/templates/${item.slug}/source`,
      poster: `/api/templates/${item.slug}/poster`,
      ...(item.reference ? { reference: `/api/templates/${item.slug}/reference` } : {}),
      ...(item.frameRecipe ? { frameRecipe: `/api/templates/${item.slug}/frame-recipe` } : {}),
      ...(item.imageRecipe ? { imageRecipe: `/api/templates/${item.slug}/image-recipe` } : {}),
    });
    for (const key of ['result', 'source', 'poster', 'reference', 'frameRecipe', 'imageRecipe'])
      if (item[key])
        media[
          `/api/templates/${item.slug}/${key === 'frameRecipe' ? 'frame-recipe' : key === 'imageRecipe' ? 'image-recipe' : key}`
        ] = remote(item[key]);
    if (item.imageRecipe) {
      const image = images.find((image) => image.clip?.sha256 === record.recipe.clip.sha256);
      if (!image || !isDeepStrictEqual(inspectFramePng(file(item.source)).workflow, image.workflow))
        throw Error('Image example must retain its executed PNG graph.');
    }
    if (item.frameRecipe) {
      const creation = json(item.frameRecipe);
      const edit = frameEdits.find(
        (edit) =>
          edit.clip?.sha256 === creation.output?.sha256 &&
          edit.request.clip.sha256 === record.recipe.clip.sha256,
      );
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
  const characters: CharacterJob[] = [];
  // Older published revisions can include H3 video receipts without the browser
  // preview bundle. Never fill their missing files from the mutable checkout.
  const hasCharacterExample = execFileSync(
    'git',
    ['ls-tree', revision, 'examples/character-h3-high/source-thumbnails.json'],
    { cwd: root, encoding: 'utf8' },
  ).trim();
  if (hasCharacterExample) {
    const folder = 'character-h3-high/',
      selection = json(folder + 'selection.json') as CharacterJob,
      replacement = json(folder + 'render.json') as CharacterJob,
      evidence = json(folder + 'evidence.json'),
      recipe = json(folder + 'recipe.json');
    const selected = characterSelectionSchema.parse(selection.request),
      request = characterRequestSchema.parse(replacement.request);
    if (
      selection.kind !== 'selection' ||
      replacement.kind !== 'replacement' ||
      selection.state !== 'succeeded' ||
      replacement.state !== 'succeeded' ||
      !selection.selection ||
      !replacement.clip ||
      request.selectionId !== selection.id ||
      evidence.format !== 'aftertake-character-bundle-check/1' ||
      evidence.maskJob !== selection.jobId ||
      evidence.nativeJob !== replacement.jobId ||
      evidence.seed !== request.seed ||
      recipe.format !== 'aftertake-character-recipe/1' ||
      recipe.jobId !== replacement.jobId ||
      !isDeepStrictEqual(recipe.selection, selected) ||
      !isDeepStrictEqual(recipe.replacement, request) ||
      !isDeepStrictEqual(recipe.output, replacement.clip)
    )
      throw Error('The recorded character example has inconsistent native receipts.');
    const info = parseCharacterSelectionInfo(selection.selection, selected),
      source = clipSchema.parse(selected.clip),
      reference = clipSchema.parse(request.reference),
      output = clipSchema.parse(replacement.clip);
    if (
      info.emptyFrames.length ||
      output.id !== replacement.id ||
      output.width !== info.width ||
      output.height !== info.height ||
      Math.abs(output.duration - info.frames / info.fps) > 1e-6 ||
      !isDeepStrictEqual(recipe.selectionInfo, info) ||
      evidence.outputSHA256 !== output.sha256 ||
      evidence.sourceSHA256 !== info.sourceSha256 ||
      evidence.maskSHA256 !== info.maskSha256 ||
      evidence.referenceSha256 !== reference.sha256
    )
      throw Error('The recorded character example differs from its source, mask or output.');
    for (const name of [
      'source.mp4',
      'prepared-source.mp4',
      'tracked-mask.mkv',
      'result.mp4',
      'selection-preview.mp4',
    ]) {
      const receipt = evidence.files[name];
      if (!receipt || digest(file(folder + name)) !== receipt.sha256)
        throw Error(`Recorded character checksum mismatch: ${name}`);
    }
    if (
      evidence.files['source.mp4'].sha256 !== source.sha256 ||
      evidence.files['prepared-source.mp4'].sha256 !== info.sourceSha256 ||
      evidence.files['tracked-mask.mkv'].sha256 !== info.maskSha256 ||
      evidence.files['result.mp4'].sha256 !== output.sha256 ||
      digest(file('character-h3/reference.png')) !== reference.sha256
    )
      throw Error('The character media does not match the recorded clip identities.');
    for (const [job, video, graph, format] of [
      [
        selection,
        'selection-preview.mp4',
        'selection-workflow-api.json',
        'aftertake-character-selection-output/1',
      ],
      [replacement, 'result.mp4', 'workflow-api.json', 'aftertake-character-output/1'],
    ] as const) {
      const metadata = readVideoMetadata(file(folder + video));
      if (
        metadata.recipe?.format !== format ||
        !isDeepStrictEqual(metadata.recipe.request, job.request) ||
        !isDeepStrictEqual(metadata.workflow, job.workflow) ||
        !isDeepStrictEqual(json(folder + graph), job.workflow)
      )
        throw Error('The recorded character video differs from its executed request or graph.');
    }
    for (const clip of [source, reference, output]) {
      const existing = clips.find((item) => item.id === clip.id);
      if (existing && !isDeepStrictEqual(existing, clip))
        throw Error('A recorded character clip conflicts with the existing example catalog.');
      if (!existing) clips.push(clip);
    }
    media[source.url] = remote(folder + 'source.mp4');
    media[reference.url] = remote('character-h3/reference.png');
    media[output.url] = remote(folder + 'result.mp4');
    media[`/api/characters/${selection.id}/source`] = remote(folder + 'prepared-source.mp4');
    media[`/api/characters/${selection.id}/preview`] = remote(folder + 'selection-preview.mp4');
    media[`/api/characters/${selection.id}/mask`] = remote(folder + 'tracked-mask.mkv');
    media[`/api/characters/${replacement.id}/recipe`] = remote(folder + 'recipe.json');
    // These sampled previews are decoded from the unchanged source, never from
    // the result poster. The existing runtime chooses the nearest recorded tick.
    const sourceThumbnails = json(folder + 'source-thumbnails.json'),
      sourceChoices: Record<string, string> = {};
    if (
      sourceThumbnails.format !== 'aftertake-recorded-source-thumbnails/1' ||
      sourceThumbnails.source !== 'source.mp4' ||
      sourceThumbnails.sourceSha256 !== source.sha256 ||
      sourceThumbnails.fps !== 24 ||
      Object.keys(sourceThumbnails.files).length !== 7
    )
      throw Error('The recorded character source preview receipt changed.');
    for (const tick of [0, 12, 24, 36, 48, 60, 72]) {
      const name =
          tick === 0 ? 'source-frame.jpg' : `source-frame-${String(tick).padStart(3, '0')}.jpg`,
        receipt = sourceThumbnails.files[name],
        bytes = file(folder + name);
      if (
        !receipt ||
        receipt.frame !== tick ||
        receipt.time !== tick / 24 ||
        receipt.width !== 960 ||
        receipt.height !== 401 ||
        receipt.size !== bytes.length ||
        receipt.sha256 !== digest(bytes)
      )
        throw Error(`The recorded character source thumbnail changed: ${name}`);
      sourceChoices[tick] = remote(folder + name);
    }
    thumbnails[source.id] = sourceChoices;
    thumbnails[reference.id] = { 0: remote('character-h3/reference.png') };
    thumbnails[output.id] = { 0: remote(folder + 'poster.jpg') };
    characters.push(selection, replacement);
  }
  renders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    format: 'aftertake-browser-demo/1',
    mediaRevision: revision,
    clips,
    renders,
    frameEdits,
    images,
    videos,
    characters,
    oneTap,
    storyboards: storyboards.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    templates,
    media,
    thumbnails,
    workspace: {
      examples: true,
      exampleCount: templates.length,
      exampleNames: Object.fromEntries(
        manifest.cases.map((item: { renderId: string; title: string }) => [
          item.renderId,
          item.title,
        ]),
      ),
      featuredRenderId: manifest.featuredRenderId,
    },
  };
}
