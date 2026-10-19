import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { routerVideoDimensions, type RouterVideoRequest } from '../src/router-video.js';

export type RouterMediaInfo = {
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

/** The supported LTX route currently returns this public Google Storage bucket. */
export function supportedRouterMediaUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (
      value.length > 8192 ||
      url.protocol !== 'https:' ||
      url.hostname !== 'storage.googleapis.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      !url.pathname.startsWith('/ltx-research-model-serving/') ||
      !url.pathname.endsWith('.mp4')
    )
      throw Error();
    return url;
  } catch {
    throw Error(
      'LTX returned an unsupported media destination. The completed request is retained for review.',
    );
  }
}

/** Asset downloads never receive the Comfy credential or follow redirects. */
export async function downloadRouterMedia(value: string, request: typeof fetch = fetch) {
  const url = supportedRouterMediaUrl(value);
  const response = await request(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(60000),
  });
  const maximum = 100 * 1024 * 1024;
  if (!response.ok || Number(response.headers.get('Content-Length') || 0) > maximum) {
    await response.body?.cancel();
    throw Error(
      'The completed hosted video could not be downloaded within the media limit. Collect it again.',
    );
  }
  if (!response.body) throw Error('The hosted video response was empty. Collect it again.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > maximum) throw Error('Hosted video exceeds the 100 MB media limit.');
      chunks.push(chunk);
    }
  } catch {
    throw Error('The hosted video download was interrupted. The original request is retained.');
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length < 16 || bytes.toString('ascii', 4, 8) !== 'ftyp')
    throw Error('The hosted model did not return an MP4. The completed request is retained.');
  return bytes;
}

const execute = promisify(execFile);
export async function inspectRouterMedia(
  filename: string,
  request: RouterVideoRequest,
  runtime: { root: string; python: string },
  inspect?: (filename: string) => Promise<RouterMediaInfo>,
) {
  const media = inspect
    ? await inspect(filename)
    : (JSON.parse(
        (
          await execute(
            runtime.python,
            [path.join(runtime.root, 'scripts/inspect-character-media.py'), filename],
            {
              timeout: 60000,
              maxBuffer: 1024 * 1024,
              env: { ...process.env, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' },
            },
          )
        ).stdout,
      ) as RouterMediaInfo);
  const expected = routerVideoDimensions(request);
  // The actual LTX service can return N+1 frames. Preserve its measured clock.
  if (
    media.width !== expected.width ||
    media.height !== expected.height ||
    media.fps !== 24 ||
    !Number.isInteger(media.frames) ||
    ![request.seconds * 24, request.seconds * 24 + 1].includes(media.frames) ||
    !media.regularTimestamps ||
    media.firstTimestamp !== 0 ||
    !Number.isFinite(media.duration) ||
    Math.abs(media.duration - media.frames / 24) > 0.001 ||
    media.hasAudio !== request.sound
  )
    throw Error(
      'The hosted video does not match its requested canvas, frame rate, duration or sound setting.',
    );
  if (
    request.sound &&
    (!media.audio ||
      !media.audio.regularTimestamps ||
      media.audio.firstTimestamp !== 0 ||
      !Number.isInteger(media.audio.samples) ||
      media.audio.samples <= 0 ||
      !Number.isInteger(media.audio.sampleRate) ||
      media.audio.sampleRate < 16000 ||
      media.audio.sampleRate > 192000 ||
      ![1, 2].includes(media.audio.channels) ||
      !Number.isFinite(media.audio.duration) ||
      Math.abs(media.audio.duration - media.duration) > 0.08 ||
      Math.abs(media.audio.samples / media.audio.sampleRate - media.audio.duration) >
        Math.max(0.05, 1024 / media.audio.sampleRate))
  )
    throw Error('The hosted sound is missing or does not cover the measured video clock.');
  return media;
}
