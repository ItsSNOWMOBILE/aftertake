import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { videoDimensions, type VideoRequest } from '../src/video-generation.js';
import { buildVideoWorkflow } from './video-workflow.js';
import { readVideoMetadata } from './video-metadata.js';

type Media = {
  width: number;
  height: number;
  frames: number;
  fps: number;
  duration: number;
  hasAudio: boolean;
  regularTimestamps: boolean;
  firstTimestamp: number;
  audio?: {
    sampleRate: number;
    channels: number;
    samples: number;
    duration: number;
    firstTimestamp: number;
    regularTimestamps: boolean;
  };
};
type Inspect = (filename: string) => Promise<Media>;
const exec = promisify(execFile);
export async function verifyGeneratedVideo(
  bytes: Buffer,
  request: VideoRequest,
  filename: string,
  inspect: Inspect | undefined,
  runtime: { root: string; python: string },
) {
  const metadata = readVideoMetadata(bytes),
    expected = buildVideoWorkflow(request),
    d = videoDimensions(request);
  if (!isDeepStrictEqual(metadata.recipe, request))
    throw Error('The generated video belongs to a different request.');
  if (
    !metadata.workflow ||
    Array.isArray(metadata.workflow) ||
    Object.keys(metadata.workflow).length !== Object.keys(expected).length
  )
    throw Error('The generated video is missing its complete native workflow.');
  for (const [id, node] of Object.entries(expected)) {
    const actual = metadata.workflow[id];
    if (actual?.class_type !== node.class_type || !isDeepStrictEqual(actual.inputs, node.inputs))
      throw Error(`The generated video workflow differs at ${id}.`);
  }
  const decode =
    inspect ||
    (async (file: string) => {
      const { stdout } = await exec(
        runtime.python,
        [path.join(runtime.root, 'scripts/inspect-character-media.py'), file],
        {
          timeout: 60000,
          maxBuffer: 1024 * 1024,
          env: { ...process.env, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' },
        },
      );
      return JSON.parse(stdout) as Media;
    });
  const media = await decode(filename);
  if (
    media.width !== d.width ||
    media.height !== d.height ||
    media.frames !== d.frames ||
    media.fps !== d.fps ||
    !media.regularTimestamps ||
    media.firstTimestamp !== 0 ||
    !Number.isFinite(media.duration) ||
    Math.abs(media.duration - d.duration) > 1 / d.fps / 10 ||
    media.hasAudio !== request.sound
  )
    throw Error(
      'The decoded video does not match the requested canvas, frame clock or sound setting.',
    );
  if (
    request.sound &&
    (!media.audio ||
      !media.audio.regularTimestamps ||
      media.audio.firstTimestamp !== 0 ||
      !media.audio.samples ||
      !Number.isFinite(media.audio.duration) ||
      Math.abs(media.audio.duration - d.duration) > 0.01)
  )
    throw Error('The generated sound is missing or does not cover the video clock.');
  return { ...media, workflow: metadata.workflow };
}
