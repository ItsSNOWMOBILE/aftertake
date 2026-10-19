import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { RequestError } from './http-errors.js';

const exec = promisify(execFile);
const checkedRuntimes = new Map<string, Promise<void>>();
const setupMessage =
  'The selected media runtime needs PyAV, Pillow, NumPy and a working imageio-ffmpeg FFmpeg executable. Run python scripts/setup-film.py, or set AFTERTAKE_PYTHON to a working media Python runtime, then restart the studio.';

type MediaRuntimeOptions = {
  root: string;
  filmPython: string;
  enginePython: string;
  override?: string;
  recordedOnly?: boolean;
  exists?: (filename: string) => Promise<boolean>;
  check?: (python: string) => Promise<void>;
};

async function isFile(filename: string) {
  return (await stat(filename).catch(() => null))?.isFile() ?? false;
}

function checkDependencies(python: string) {
  let pending = checkedRuntimes.get(python);
  if (!pending) {
    // Check CPU media imports and the actual FFmpeg binary. No Torch, models
    // or execution-device changes; the outer deadline bounds this process.
    pending = exec(
      python,
      [
        '-c',
        'import av\nfrom PIL import Image\nimport imageio_ffmpeg\nimport numpy\nimageio_ffmpeg.get_ffmpeg_version()\n',
      ],
      { timeout: 25_000, maxBuffer: 64 * 1024, windowsHide: true },
    ).then(() => {});
    checkedRuntimes.set(python, pending);
    const attempt = pending;
    void attempt.catch(() => {
      if (checkedRuntimes.get(python) === attempt) checkedRuntimes.delete(python);
    });
  }
  return pending;
}

/** Select only the CPU media subprocess runtime, independently of the CUDA engine. */
export async function resolveMediaRuntime(options: MediaRuntimeOptions): Promise<string> {
  const exists = options.exists ?? isFile;
  const check = options.check ?? checkDependencies;
  const recordedOnly = options.recordedOnly ?? process.env.AFTERTAKE_EXAMPLES === '1';
  const override = (options.override ?? process.env.AFTERTAKE_PYTHON)?.trim();
  const absolute = (filename: string) => path.resolve(options.root, filename);
  const filmPython = absolute(options.filmPython);

  try {
    if (override) {
      const selected = absolute(override);
      // Preserve an explicitly missing runtime so existing media routes can
      // return their setup-specific 409, while recorded views remain available.
      if ((await exists(selected)) && !recordedOnly) await check(selected);
      return selected;
    }

    let installed = false;
    for (const selected of new Set([filmPython, absolute(options.enginePython)])) {
      if (!(await exists(selected))) continue;
      installed = true;
      if (recordedOnly) return selected;
      try {
        await check(selected);
        return selected;
      } catch {
        // A partial GPU installation must not shadow the independent media runtime.
      }
    }
    if (!installed) return filmPython;
    throw new Error('Installed runtimes are incomplete.');
  } catch {
    throw new RequestError(setupMessage, 409);
  }
}
