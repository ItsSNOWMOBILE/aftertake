import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Preparing a Cloud source failed on this computer: nothing reached Comfy Cloud. */
export class CloudSourceError extends Error {}

/**
 * Run scripts/cloud-media.py, which stands in for Aftertake's loader, grade and
 * saver around a Comfy Cloud job. The job file holds local paths only.
 */
export async function runCloudMedia(
  runtime: { root: string; python: string },
  mode: 'prepare' | 'finish',
  job: Record<string, unknown>,
  folder: string,
) {
  const file = path.join(folder, `cloud-media-${randomUUID()}.json`);
  await writeFile(file, JSON.stringify(job));
  try {
    const { stdout } = await exec(
      runtime.python,
      [path.join(runtime.root, 'scripts/cloud-media.py'), mode, file],
      { timeout: 600000, maxBuffer: 1024 * 1024, windowsHide: true },
    );
    return JSON.parse(stdout) as { frames: number; width: number; height: number };
  } finally {
    await unlink(file).catch(() => {});
  }
}
