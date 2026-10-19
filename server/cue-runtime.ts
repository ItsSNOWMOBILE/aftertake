import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { RequestError } from './http-errors.js';

const exec = promisify(execFile);
const setupMessage =
  'Motion previews need Torch, PyAV, OpenCV and Pillow. Run the Aftertake local engine setup, or set AFTERTAKE_CUE_PYTHON to a Python runtime with these packages installed, then retry.';

type CueRuntimeOptions = {
  root: string;
  enginePython: string;
  mediaPython: string;
  override?: string;
  exists?: (filename: string) => Promise<boolean>;
  check?: (python: string) => Promise<void>;
};

async function isFile(filename: string) {
  return (await stat(filename).catch(() => null))?.isFile() ?? false;
}

async function checkDependencies(python: string) {
  // Import-only: this does not allocate a model, probe CUDA or change inference devices.
  await exec(python, ['-c', 'import torch\nimport av\nimport cv2\nfrom PIL import Image\n'], {
    timeout: 25_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  });
}

/** Cue tracking has different dependencies from the lightweight Film/media runtime. */
export function createCueRuntime(options: CueRuntimeOptions) {
  const exists = options.exists ?? isFile;
  const check = options.check ?? checkDependencies;
  const override = (options.override ?? process.env.AFTERTAKE_CUE_PYTHON)?.trim();
  const absolute = (filename: string) => path.resolve(options.root, filename);
  let pending: Promise<string> | undefined;

  async function prepare() {
    try {
      const enginePython = absolute(options.enginePython);
      const python = override
        ? absolute(override)
        : (await exists(enginePython))
          ? enginePython
          : absolute(options.mediaPython);
      if (!(await exists(python))) throw new Error('Runtime missing.');
      // A selected runtime is authoritative: missing packages must not silently
      // switch execution to a different Python installation.
      await check(python);
      return python;
    } catch {
      throw new RequestError(setupMessage, 409);
    }
  }

  return {
    ready(): Promise<string> {
      if (!pending) {
        const attempt = prepare();
        pending = attempt;
        // Keep successful checks cached; a setup repair can be retried without
        // restarting the studio after a failed dependency check.
        void attempt.catch(() => {
          if (pending === attempt) pending = undefined;
        });
      }
      return pending;
    },
  };
}
