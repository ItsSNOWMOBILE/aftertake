import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const option = (name, fallback) => process.argv.find((a) => a.startsWith(name + '='))?.slice(name.length + 1) || fallback;
const here = path.dirname(fileURLToPath(import.meta.url));
const base = option('--url', 'http://127.0.0.1:4312');
const serverRoot = path.resolve(option('--server-root', process.cwd()));
const mediaRoot = path.resolve(option('--media-root', process.cwd()));
const out = path.resolve(option('--out', '.runtime/move-your-way-replay'));
const python = option('--python', '');
const doExport = process.argv.includes('--export');
await mkdir(out, { recursive: true });
const projects = await Promise.all(['project.json', 'campaign-landscape.json', 'campaign-portrait.json', 'campaign-square.json'].map(async (name) => ({ name, project: JSON.parse(await readFile(path.join(here, name), 'utf8')) })));
const hash = (data) => createHash('sha256').update(data).digest('hex');
const trace = [];
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/TOKEN|KEY|SECRET|PASSWORD|COMFY/i.test(name)));
const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'server/mcp.ts', '--url', base, '--media-root', mediaRoot, '--state-dir', path.join(out, 'plans'), ...(python ? ['--python', python] : [])], cwd: serverRoot, env, stderr: 'pipe' });
const client = new Client({ name: 'aftertake-portable-campaign-replay', version: '1.0.0' });
async function call(name, args) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) throw Error(name + ': ' + JSON.stringify(response.content));
  trace.push({ tool: name, arguments: args, result: response.structuredContent });
  await writeFile(path.join(out, 'mcp-trace.json'), JSON.stringify(trace, null, 2) + '\n');
  return response.structuredContent;
}
try {
  await client.connect(transport);
  const unique = new Map();
  for (const { project } of projects) for (const source of Object.values(project.sourceFiles)) unique.set(source.sha256, source);
  const imports = [];
  for (const [expected, source] of unique) {
    const filename = path.resolve(mediaRoot, source.path);
    if (path.relative(mediaRoot, filename).startsWith('..') || hash(await readFile(filename)) !== expected) throw Error('Source path/hash mismatch');
    const result = await call('aftertake_import_media', { path: filename, destination: 'film' });
    if (result.asset.sha256 !== expected) throw Error('Imported media hash differs');
    imports.push({ sha256: expected, assetId: result.asset.id });
  }
  const saved = [];
  for (const { name, project } of projects) {
    const response = await fetch(base + '/api/films/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project) });
    const rebound = await response.json();
    if (!response.ok) throw Error(JSON.stringify(rebound));
    const ids = [['shots', 'assetId'], ['audio', 'assetId'], ['graphics', 'assetId']];
    const checked = ids.flatMap(([field, key]) => (project[field] || []).flatMap((item, index) => item[key] ? [{ field, original: item[key], current: rebound[field][index][key] }] : []));
    const plan = await call('aftertake_save_film_edit', { project });
    saved.push({ name, plan, sourceBindings: Object.keys(project.sourceFiles).length, allAssetIdsRebound: checked.every((row) => row.original !== row.current) });
  }
  let exported;
  if (doExport) exported = await call('aftertake_export_plan', { planId: saved[0].plan.planId, attempt: 0 });
  const receipt = { format: 'aftertake-portable-mcp-replay/1', base, importedUniqueAssets: imports.length, imports, projects: saved, exported };
  await writeFile(path.join(out, 'accepted.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
} finally { await client.close(); }
