import { readFile, writeFile, readdir, realpath, lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { buildDemoSnapshot } from './browser-demo-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(
  root,
  process.argv.find((value) => value.startsWith('--out-dir='))?.slice(10) || 'docs/studio',
);
const resolvedRoot = await realpath(root),
  resolvedParent = await realpath(path.dirname(output));
if (
  !resolvedParent.startsWith(resolvedRoot + path.sep) ||
  (await lstat(output).catch(() => null))?.isSymbolicLink()
)
  throw Error('The generated browser-demo directory must stay inside this checkout.');
const revision =
  process.argv.find((value) => value.startsWith('--media-ref='))?.slice(12) ||
  '78253f894e5e90a76561701551f6fa343f9ddb87';
const mediaBase = process.argv.find((value) => value.startsWith('--media-base='))?.slice(13);
const snapshot = buildDemoSnapshot(root, revision, { mediaBase });
const fontBase = process.argv.find((value) => value.startsWith('--font-base='))?.slice(12);
if (fontBase) {
  const url = new URL(fontBase);
  if (url.protocol !== 'https:' || url.search || url.hash || !fontBase.endsWith('/'))
    throw Error('Use an HTTPS font directory ending in / without a query or fragment.');
}
const fonts = Object.fromEntries(
  await Promise.all(
    ['dm-sans.ttf', 'manrope.ttf'].map(async (name) => [
      name,
      (await readFile(path.join(root, 'public/fonts', name))).toString('base64'),
    ]),
  ),
);
const favicon = (await readFile(path.join(root, 'public/brand/favicon.svg'))).toString('base64');
if (fontBase)
  snapshot.externalFonts = Object.entries(fonts).map(([name, bytes]) => ({
    name,
    url: new URL(name, fontBase).href,
    sha256: createHash('sha256').update(Buffer.from(bytes, 'base64')).digest('hex'),
  }));
const require = createRequire(path.join(root, 'package.json'));
const notices = ['Aftertake app code\n' + (await readFile(path.join(root, 'LICENSE'), 'utf8'))];
for (const name of ['dmsans-OFL.txt', 'manrope-OFL.txt'])
  notices.push(name + '\n' + (await readFile(path.join(root, 'public/fonts', name), 'utf8')));
for (const name of ['react', 'react-dom', 'lucide-react', 'zod', 'scheduler']) {
  const lookup =
    name === 'scheduler' ? createRequire(require.resolve('react-dom/package.json')) : require;
  let folder = path.dirname(lookup.resolve(name));
  while (true) {
    const metadata = await readFile(path.join(folder, 'package.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    if (metadata?.name === name) break;
    const parent = path.dirname(folder);
    if (parent === folder) throw Error('Could not locate dependency license: ' + name);
    folder = parent;
  }
  const license = (await readdir(folder)).find((file) => /^licen[cs]e(?:\.md|\.txt)?$/i.test(file));
  if (!license) throw Error('Missing dependency license: ' + name);
  notices.push(name + '\n' + (await readFile(path.join(folder, license), 'utf8')));
}
const licenseText = notices
  .join('\n\n----------------------------------------\n\n')
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .join('\n')
  .trimEnd();
await build({
  root,
  base: './',
  publicDir: false,
  define: {
    'import.meta.env.VITE_BROWSER_DEMO': JSON.stringify('1'),
    'import.meta.env.VITE_BLOB_PREVIEWS': JSON.stringify(
      process.argv.includes('--blob-previews') ? '1' : '0',
    ),
  },
  plugins: [
    {
      name: 'browser-demo-fonts',
      enforce: 'pre',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          return html.replace('/brand/favicon.svg', `data:image/svg+xml;base64,${favicon}`);
        },
      },
      transform(code, id) {
        if (!id.replaceAll('\\', '/').endsWith('/src/style.css')) return;
        for (const [name, bytes] of Object.entries(fonts))
          code = code.replaceAll(
            `/fonts/${name}`,
            fontBase ? new URL(name, fontBase).href : `data:font/ttf;base64,${bytes}`,
          );
        return code;
      },
    },
  ],
  build: { outDir: output, emptyOutDir: true },
});
await writeFile(path.join(output, 'snapshot.json'), JSON.stringify(snapshot) + '\n');
await writeFile(path.join(output, 'licenses.txt'), licenseText + '\n');
for (const file of await readdir(path.join(output, 'assets'))) {
  if (!/\.(js|css)$/.test(file)) continue;
  const filename = path.join(output, 'assets', file),
    code = await readFile(filename, 'utf8');
  await writeFile(
    filename,
    '/*!\n' + licenseText.replaceAll('*/', '* /') + '\n*/\n' + code.trimEnd() + '\n',
  );
}
console.log(
  `Browser demo: ${snapshot.templates.length} recorded examples pinned to ${revision}. No inference endpoint.`,
);
