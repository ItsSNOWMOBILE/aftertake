#!/usr/bin/env node
// One command to check, install and launch Aftertake on Windows, macOS or Linux.
// Plain Node with no dependencies, so it runs before anything is installed.
//
//   node scripts/aftertake.mjs              check, install what is missing, launch the studio
//   node scripts/aftertake.mjs --examples   the same, in the recorded example workspace
//   node scripts/aftertake.mjs doctor       print the setup checklist only
//   node scripts/aftertake.mjs setup-gpu    install local generation (NVIDIA, Windows or Linux)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statfsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith('--')) || 'start';
const flag = (name) => args.includes(`--${name}`);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];
const port = Number(option('port') || process.env.PORT || 4310);
const ENGINE_PROFILES = {
  video: ['download', '--text-video'],
  image: ['download', '--image-gen'],
  'frame-edit': ['download', '--frame-edit'],
  'motion-transfer': ['download', '--motion-transfer'],
  camera: ['download', '--motion'],
  'region-edit': ['setup', '--inpaint'],
  'character-swap': ['setup', '--character-swap'],
  depth: ['setup', '--depth-effects'],
};
const INSTALL = {
  python: {
    win32: 'winget install Python.Python.3.12',
    darwin: 'brew install python@3.12',
    linux: 'sudo apt install python3.12 python3.12-venv',
  },
  ffmpeg: {
    win32: 'winget install Gyan.FFmpeg',
    darwin: 'brew install ffmpeg',
    linux: 'sudo apt install ffmpeg',
  },
};
const hint = (tool) => INSTALL[tool][process.platform] || INSTALL[tool].linux;
// On Windows these package tools are .cmd files, which only start through a shell.
const shell = (program) => windows && ['pnpm', 'corepack', 'npx'].includes(program);

/** Run a program quietly and return its trimmed output, or null when it is unavailable. */
function probe(program, programArgs) {
  const result = spawnSync(program, programArgs, { encoding: 'utf8', shell: shell(program) });
  return result.status === 0 ? `${result.stdout}${result.stderr}`.trim() : null;
}
function python(versions) {
  const candidates = windows
    ? versions.map((version) => ['py', [`-${version}`]]).concat([['python', []]])
    : versions
        .map((version) => [`python${version}`, []])
        .concat([
          ['python3', []],
          ['python', []],
        ]);
  for (const [program, prefix] of candidates) {
    const version = probe(program, [
      ...prefix,
      '-c',
      'import sys;print("%d.%d" % sys.version_info[:2])',
    ]);
    if (version && versions.includes(version)) return { program, prefix, version };
  }
  return null;
}
const venvPython = (folder) =>
  path.join(root, '.runtime', folder, windows ? 'Scripts/python.exe' : 'bin/python');

function checks() {
  const node = process.versions.node.split('.').map(Number);
  const nvidia = probe('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader']);
  let free = null;
  try {
    const disk = statfsSync(root);
    free = (disk.bavail * disk.bsize) / 1e9;
  } catch {
    // statfs is unavailable on some file systems; the disk line is then omitted.
  }
  return {
    node: {
      ok: node[0] > 22 || (node[0] === 22 && node[1] >= 12),
      detail: `Node.js ${process.versions.node}`,
    },
    dependencies: existsSync(path.join(root, 'node_modules/tsx')),
    media: existsSync(venvPython('film-venv')),
    // The media runtime's pinned NumPy and PyAV need Python 3.12 or newer.
    python: python(['3.12', '3.13', '3.14']),
    python312: python(['3.12']),
    gpu: nvidia?.split('\n')[0] || null,
    gpuPlatform: (windows || process.platform === 'linux') && ['x64'].includes(process.arch),
    engine: existsSync(venvPython('venv')) && existsSync(path.join(root, '.runtime/ComfyUI')),
    ffmpeg: Boolean(probe('ffmpeg', ['-version'])),
    free,
  };
}

function report(state) {
  const line = (ok, text, fix) =>
    console.log(
      `  ${ok === null ? '[--]' : ok ? '[ok]' : '[!!]'} ${text}${!ok && fix ? `\n         -> ${fix}` : ''}`,
    );
  console.log('\nAftertake setup check\n');
  line(
    state.node.ok,
    state.node.detail + (state.node.ok ? '' : ' (needs 22.12 or newer)'),
    'Install Node.js 22 LTS from https://nodejs.org',
  );
  line(state.dependencies, 'App dependencies', 'This launcher installs them on start');
  line(
    state.media,
    'Media runtime for importing footage, Film export and Color & finish',
    state.python ? 'This launcher installs it on start' : `Install Python first: ${hint('python')}`,
  );
  line(
    Boolean(state.python),
    state.python ? `Python ${state.python.version}` : 'Python 3.12 or newer',
    hint('python'),
  );
  console.log('\n  Local generation (optional; the examples, editing and Film work without it)\n');
  if (!state.gpuPlatform)
    line(
      null,
      'Generation needs Windows or Linux on x64 with an NVIDIA GPU; this computer runs the studio only',
    );
  else {
    line(
      Boolean(state.gpu),
      state.gpu ? `NVIDIA GPU: ${state.gpu}` : 'NVIDIA GPU with 16 GB of memory',
      'Install the NVIDIA driver, then check with nvidia-smi',
    );
    line(
      Boolean(state.python312),
      state.python312 ? 'Python 3.12 for the engine' : 'Python 3.12 for the engine',
      hint('python'),
    );
    line(state.engine, 'Generation engine', 'node scripts/aftertake.mjs setup-gpu --video');
    line(state.ffmpeg, 'FFmpeg on PATH (character replacement only)', hint('ffmpeg'));
    if (state.free !== null)
      line(
        state.free > 60,
        `${state.free.toFixed(0)} GB free on this disk`,
        'Each model profile needs 20 to 45 GB; add --models-dir=PATH to use another disk',
      );
  }
  console.log('');
}

function run(program, programArgs, label) {
  console.log(`> ${[program, ...programArgs].join(' ')}`);
  const result = spawnSync(program, programArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: shell(program),
  });
  if (result.status !== 0)
    throw new Error(`${label} did not finish. Fix the message above, then run this again.`);
}
function pnpm(pnpmArgs, label) {
  if (probe('pnpm', ['--version'])) return run('pnpm', pnpmArgs, label);
  if (probe('corepack', ['--version'])) return run('corepack', ['pnpm', ...pnpmArgs], label);
  return run('npx', ['--yes', 'pnpm@11.25.0', ...pnpmArgs], label);
}

/** Start a child whose output is prefixed, and stop it when the launcher stops. */
function background(label, program, programArgs, env = {}) {
  const child = spawn(program, programArgs, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      for (const text of String(chunk).split(/\r?\n/)) if (text) console.log(`[${label}] ${text}`);
    });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
  process.on('exit', () => child.kill());
  return child;
}
async function live(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}
function openBrowser(url) {
  const [program, programArgs] = windows
    ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  spawn(program, programArgs, { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
}

async function start() {
  let state = checks();
  report(state);
  if (!state.node.ok) throw new Error('Install Node.js 22.12 or newer, then run this again.');
  if (!state.dependencies) pnpm(['install', '--frozen-lockfile'], 'Installing app dependencies');
  if (!state.media && state.python) {
    console.log('Installing the media runtime (a few small packages, once)...');
    run(
      state.python.program,
      [...state.python.prefix, 'scripts/setup-film.py'],
      'Installing the media runtime',
    );
  }
  state = checks();
  if (state.engine && state.python312 && !(await live('http://127.0.0.1:8189/api/v2/health'))) {
    console.log('Starting the local generation engine...');
    background('engine', state.python312.program, [
      ...state.python312.prefix,
      'scripts/engine.py',
      '--safe-weight-copies',
      '--no-node-cache',
    ]);
  }
  const env = { PORT: String(port) };
  if (flag('examples')) {
    const { loadExamples } = await import('./load-examples.mjs');
    const { data, manifest } = await loadExamples('.data-demo');
    Object.assign(env, {
      AFTERTAKE_DATA_DIR: data,
      AFTERTAKE_EXAMPLES: '1',
      AFTERTAKE_EXAMPLE_COUNT: String(manifest.cases.length),
      AFTERTAKE_EXAMPLE_TITLES: JSON.stringify(
        Object.fromEntries(manifest.cases.map((item) => [item.renderId, item.title])),
      ),
      AFTERTAKE_FEATURED_RENDER: manifest.featuredRenderId,
    });
  }
  const studio = background(
    'studio',
    process.execPath,
    ['--import', 'tsx', 'server/index.ts'],
    env,
  );
  studio.on('exit', (code) => process.exit(code ?? 0));
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120 && !(await live(`${url}/api/workspace`)); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 500));
  console.log(`\nAftertake is ready: ${url}\nPress Ctrl+C to stop.\n`);
  if (!flag('no-open')) openBrowser(url);
}

function setupGpu() {
  const state = checks();
  if (!state.gpuPlatform)
    throw new Error('Local generation needs Windows or Linux on x64 with an NVIDIA GPU.');
  if (!state.gpu)
    throw new Error(
      'No NVIDIA GPU was found. Install the NVIDIA driver and check with nvidia-smi.',
    );
  if (!state.python312) throw new Error(`Local generation needs Python 3.12: ${hint('python')}`);
  const chosen = Object.keys(ENGINE_PROFILES).filter((name) => flag(name));
  const profiles = chosen.length ? chosen : ['video'];
  const py = [state.python312.program, state.python312.prefix];
  const models = option('models-dir') ? [`--models-dir=${option('models-dir')}`] : [];
  if (!state.engine)
    run(py[0], [...py[1], 'scripts/setup.py', '--skip-models', ...models], 'Installing the engine');
  for (const name of profiles) {
    const [kind, profileFlag] = ENGINE_PROFILES[name];
    const script = kind === 'setup' ? 'scripts/setup.py' : 'scripts/download-models.py';
    run(py[0], [...py[1], script, profileFlag, ...models], `Installing ${name}`);
  }
  console.log(
    `\nInstalled: ${profiles.join(', ')}. Start Aftertake with: node scripts/aftertake.mjs\n`,
  );
}

try {
  if (command === 'doctor') report(checks());
  else if (command === 'setup-gpu') setupGpu();
  else if (command === 'start') await start();
  else
    throw new Error(`Unknown command "${command}". Use doctor, setup-gpu, or no command to start.`);
} catch (failure) {
  console.error(`\n${failure.message}\n`);
  process.exitCode = 1;
}
