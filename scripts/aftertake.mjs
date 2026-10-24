#!/usr/bin/env node
// One command to check, install and launch Aftertake on Windows, macOS or Linux.
// Plain Node with no dependencies, so it runs before anything is installed.
//
//   node scripts/aftertake.mjs              check, install what is missing, launch the studio
//   node scripts/aftertake.mjs --examples   the same, in the recorded example workspace
//   node scripts/aftertake.mjs share        share a separate copy through an access link (docs/share.md)
//   node scripts/aftertake.mjs doctor       print the setup checklist only
//   node scripts/aftertake.mjs setup-gpu    install local generation (NVIDIA, Windows or Linux)
//   node scripts/aftertake.mjs setup-npu    install local depth on the Neural Engine, an NPU or the CPU
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
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
  upscale: ['download', '--upscale'],
  interpolate: ['download', '--interpolate'],
  song: ['download', '--song'],
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
  // An installed runtime can remain usable after the system Python is removed
  // from PATH, or when the Windows Python launcher is not installed.
  const local = ['venv', 'film-venv']
    .map(venvPython)
    .filter((program) => existsSync(program))
    .map((program) => [program, []]);
  const system = windows
    ? versions.map((version) => ['py', [`-${version}`]]).concat([['python', []]])
    : versions
        .map((version) => [`python${version}`, []])
        .concat([
          ['python3', []],
          ['python', []],
        ]);
  for (const [program, prefix] of [...local, ...system]) {
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

/** Local depth runs in the media runtime through ONNX Runtime; null until that runtime exists. */
function depthStatus() {
  if (!existsSync(venvPython('film-venv'))) return null;
  const output = probe(venvPython('film-venv'), ['scripts/depth_runtime.py', '--status']);
  try {
    return output ? JSON.parse(output.split('\n').at(-1)) : null;
  } catch {
    return null;
  }
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
  const depth = depthStatus();
  line(
    depth ? Boolean(depth.runtime && depth.model) : null,
    depth?.runtime && depth.model
      ? `Local depth for foreground protection: ${depth.accelerator}`
      : 'Local depth for foreground protection (optional; uses the Neural Engine or an NPU when present)',
    'node scripts/aftertake.mjs setup-npu',
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

/** Install what is missing and start the local engine when it is installed. */
async function prepare() {
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
}
/** Load the recorded examples into a workspace folder and describe it to the studio. */
async function exampleWorkspace(directory) {
  const { loadExamples } = await import('./load-examples.mjs');
  const { data, manifest } = await loadExamples(directory);
  return {
    data,
    env: {
      AFTERTAKE_DATA_DIR: data,
      AFTERTAKE_EXAMPLES: '1',
      AFTERTAKE_EXAMPLE_COUNT: String(manifest.cases.length),
      AFTERTAKE_EXAMPLE_TITLES: JSON.stringify(
        Object.fromEntries(manifest.cases.map((item) => [item.renderId, item.title])),
      ),
      AFTERTAKE_FEATURED_RENDER: manifest.featuredRenderId,
    },
  };
}
async function waitFor(url) {
  for (let attempt = 0; attempt < 120 && !(await live(url)); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 500));
}

async function start() {
  await prepare();
  const env = { PORT: String(port) };
  if (flag('examples')) Object.assign(env, (await exampleWorkspace('.data-demo')).env);
  const studio = background(
    'studio',
    process.execPath,
    ['--import', 'tsx', 'server/index.ts'],
    env,
  );
  studio.on('exit', (code) => process.exit(code ?? 0));
  const url = `http://127.0.0.1:${port}`;
  await waitFor(`${url}/api/workspace`);
  console.log(`\nAftertake is ready: ${url}\nPress Ctrl+C to stop.\n`);
  if (!flag('no-open')) openBrowser(url);
}

/** This computer's HTTPS address on Tailscale, when Tailscale is installed and signed in. */
function tailscaleAddress() {
  const result = spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  try {
    const name = JSON.parse(result.stdout).Self?.DNSName;
    return name ? `https://${name.replace(/\.$/, '')}` : null;
  } catch {
    return null;
  }
}

/**
 * Share a separate copy of the studio, with its own workspace of recorded
 * examples, through a gateway that only admits holders of the access link.
 * A tunnel such as Tailscale Funnel then points at the gateway's port.
 */
async function share() {
  await prepare();
  pnpm(['exec', 'vite', 'build'], 'Building the studio');
  if (flag('reset')) rmSync(path.join(root, '.data-share'), { recursive: true, force: true });
  const { data, env } = await exampleWorkspace('.data-share').catch((failure) => {
    throw new Error(
      `${failure.message}\nA visitor may have changed a recorded example. Run share --reset to start the shared workspace fresh.`,
    );
  });
  let token = process.env.AFTERTAKE_SHARE_TOKEN?.trim();
  if (!token) {
    const saved = path.join(data, 'share-token');
    if (flag('new-link') || !existsSync(saved))
      writeFileSync(saved, `${randomBytes(18).toString('base64url')}\n`, { mode: 0o600 });
    token = readFileSync(saved, 'utf8').trim();
  }
  if (token.length < 16) throw new Error('Use an AFTERTAKE_SHARE_TOKEN of at least 16 characters.');
  const studioPort = Number(option('studio-port') || 4311);
  const sharePort = Number(option('share-port') || 7860);
  const perVisitor = Number(option('renders-per-visitor') || 20);
  const perDay = Number(option('renders-per-day') || 150);
  const studio = background(
    'studio',
    process.execPath,
    ['--import', 'tsx', 'server/index.ts', '--production'],
    { ...env, PORT: String(studioPort) },
  );
  studio.on('exit', (code) => process.exit(code ?? 0));
  const local = `http://127.0.0.1:${studioPort}`;
  await waitFor(`${local}/api/workspace`);
  const { createShareGateway } = await import('./share-gateway.mjs');
  const gateway = createShareGateway({
    studioPort,
    token,
    rendersPerVisitor: perVisitor,
    rendersPerDay: perDay,
  });
  await new Promise((resolve, reject) =>
    gateway.once('error', reject).listen(sharePort, '127.0.0.1', resolve),
  ).catch((failure) => {
    studio.removeAllListeners('exit');
    studio.kill();
    throw new Error(
      failure.code === 'EADDRINUSE'
        ? `Port ${sharePort} is already in use. Stop what uses it, or choose another with --share-port=N.`
        : failure.message,
    );
  });
  const tunnel = tailscaleAddress();
  console.log(`\nAftertake is shared on port ${sharePort} of this computer.`);
  if (tunnel) {
    console.log(`  Send this link:  ${tunnel}/?access=${token}`);
    console.log(`  Turn on the tunnel once with:  tailscale funnel --bg ${sharePort}`);
  } else
    console.log(
      `  Point a tunnel at port ${sharePort}, then send <tunnel address>/?access=${token}\n  docs/share.md sets up a free Tailscale Funnel.`,
    );
  console.log(
    `  Choose where its studios render at ${local} (Render setup). Visitors can't change it.\n  Each visitor can start ${perVisitor} renders a day, ${perDay} in all. Press Ctrl+C to stop sharing.\n`,
  );
}

function setupNpu() {
  let state = checks();
  if (!state.media) {
    if (!state.python) throw new Error(`Install Python first: ${hint('python')}`);
    run(
      state.python.program,
      [...state.python.prefix, 'scripts/setup-film.py'],
      'Installing the media runtime',
    );
    state = checks();
  }
  const provider = option('provider');
  run(
    venvPython('film-venv'),
    ['scripts/setup-depth.py', ...(provider ? [`--provider=${provider}`] : [])],
    'Installing local depth',
  );
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
  else if (command === 'setup-npu') setupNpu();
  else if (command === 'start') await start();
  else if (command === 'share') await share();
  else
    throw new Error(
      `Unknown command "${command}". Use doctor, setup-gpu, setup-npu, share, or no command to start.`,
    );
} catch (failure) {
  console.error(`\n${failure.message}\n`);
  process.exitCode = 1;
}
