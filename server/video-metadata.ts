import { isDeepStrictEqual } from 'node:util';
import { recipeSchema, type Recipe } from '../src/domain.js';

/** Read the MP4 comment written by AftertakeSaveVideo, without a Python runtime. */
export function readVideoMetadata(bytes: Buffer) {
  if (bytes.length < 16 || bytes.toString('ascii', 4, 8) !== 'ftyp')
    throw Error('The video workflow did not return an MP4.');
  let comment: string | undefined,
    media = false,
    movie = false;
  function boxes(start: number, limit: number, parents: string[] = []) {
    if (parents.length > 12) throw Error('The video metadata is nested too deeply.');
    for (let offset = start; offset < limit;) {
      if (offset + 8 > limit) throw Error('The generated video is incomplete.');
      let size = bytes.readUInt32BE(offset),
        header = 8;
      const type = bytes.toString('latin1', offset + 4, offset + 8);
      if (size === 1) {
        if (offset + 16 > limit) throw Error('The generated video is incomplete.');
        const large = bytes.readBigUInt64BE(offset + 8);
        if (large > BigInt(Number.MAX_SAFE_INTEGER))
          throw Error('The video contains an invalid box size.');
        size = Number(large);
        header = 16;
      } else if (size === 0) size = limit - offset;
      const end = offset + size,
        payload = offset + header;
      if (size < header || end > limit) throw Error('The generated video is incomplete.');
      if (type === 'mdat' && size > header) media = true;
      if (type === 'moov') movie = true;
      if (['moov', 'udta', 'meta', 'ilst', '©cmt'].includes(type)) {
        const content = payload + (type === 'meta' ? 4 : 0);
        if (content > end) throw Error('The generated video metadata is incomplete.');
        boxes(content, end, [...parents, type]);
      } else if (type === 'data' && parents.at(-1) === '©cmt') {
        if (end - payload < 8 || (bytes.readUInt32BE(payload) & 0xffffff) !== 1)
          throw Error('The video comment is not UTF-8 metadata.');
        comment = bytes.toString('utf8', payload + 8, end);
      }
      offset = end;
    }
  }
  boxes(0, bytes.length);
  if (!movie || !media || !comment)
    throw Error('The video is missing its executed workflow. Update the Aftertake nodes.');
  return JSON.parse(comment) as { recipe: any; workflow: Record<string, any> };
}
export function inspectVideoMetadata(bytes: Buffer, expected?: Recipe) {
  const metadata = readVideoMetadata(bytes),
    recipe = recipeSchema.parse(metadata.recipe),
    workflow = metadata.workflow;
  if (
    !workflow ||
    typeof workflow !== 'object' ||
    Array.isArray(workflow) ||
    !Object.keys(workflow).length
  )
    throw Error('The video is missing its executed workflow.');
  for (const node of Object.values(workflow) as any[]) {
    if (
      !node ||
      typeof node.class_type !== 'string' ||
      !node.inputs ||
      typeof node.inputs !== 'object' ||
      Array.isArray(node.inputs)
    )
      throw Error('The video contains an invalid executed workflow.');
  }
  if (
    expected &&
    !isDeepStrictEqual(JSON.parse(JSON.stringify(recipe)), JSON.parse(JSON.stringify(expected)))
  )
    throw Error('The downloaded video does not match the submitted recipe.');
  return { recipe, workflow: workflow as Record<string, unknown> };
}
