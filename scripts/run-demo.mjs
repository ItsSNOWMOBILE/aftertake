import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadExamples } from './load-examples.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(
  process.argv.find((arg) => arg.startsWith('--port='))?.slice(7) || process.env.PORT || 4312,
);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Choose a local demo port between 1024 and 65535');
const directory =
  process.argv.find((arg) => arg.startsWith('--data-dir='))?.slice(11) || '.data-demo';
const { data, manifest } = await loadExamples(directory);
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: String(port),
    AFTERTAKE_DATA_DIR: data,
    AFTERTAKE_EXAMPLES: '1',
    AFTERTAKE_EXAMPLE_COUNT: String(manifest.cases.length),
    AFTERTAKE_EXAMPLE_TITLES: JSON.stringify(
      Object.fromEntries(manifest.cases.map((item) => [item.renderId, item.title])),
    ),
    AFTERTAKE_FEATURED_RENDER: manifest.featuredRenderId,
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
