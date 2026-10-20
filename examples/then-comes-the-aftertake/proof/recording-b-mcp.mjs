/** Real stdio MCP proof client. --help / --dry-check never connect or generate. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const own = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
function option(name, fallback) {
  const at = argv.indexOf(name);
  if (at < 0) return fallback;
  if (!argv[at + 1] || argv[at + 1].startsWith('--')) throw Error(`Missing value for ${name}`);
  return argv[at + 1];
}
function numberOption(name, fallback, min, max) {
  const value = Number(option(name, String(fallback)));
  if (!Number.isInteger(value) || value < min || value > max) throw Error(`Invalid ${name}`);
  return value;
}
function help() {
  process.stdout.write(`Aftertake Recording B — genuine MCP client\n\n` +
    `Preparation only:\n  node recording-b-mcp.mjs --help\n  node recording-b-mcp.mjs --dry-check [--repo PATH]\n\n` +
    `Live proof (starts the stdio MCP subprocess and deliberately generates one image):\n` +
    `  node recording-b-mcp.mjs --run --repo PATH --studio http://127.0.0.1:4396 --out PATH\n\n` +
    `Options:\n` +
    `  --request-id ID       Fixed native operation key (default job4-hero-banner-mcp-20261020-v1)\n` +
    `  --seed N              Fixed image seed (default 509074)\n` +
    `  --name NAME           Agent-chosen image name\n` +
    `  --resolution MODE     720p or standard (default 720p)\n` +
    `  --launcher MODE       pnpm or npm (npm when --npm-cli is supplied, otherwise pnpm)\n` +
    `  --npm-cli PATH        Path to a real npm-cli.js when using --launcher npm\n` +
    `  --pnpm-cli PATH       Override installed pnpm.mjs\n` +
    `  --python PATH         CPU media Python used by aftertake_inspect_picture\n` +
    `  --gated               Wait for Enter before each real protocol call; gates are labeled\n` +
    `  --reading-pause-ms N  Explicit reading pause after major real responses (default 0)\n` +
    `  --terminal-rows N     Optional VT scrolling viewport height (default 0, disabled)\n` +
    `  --terminal-cols N     Optional on-screen hard-wrap width (default 0, disabled)\n` +
    `  --poll-ms N           Actual polling interval (default 2000; no fake compute delay)\n` +
    `  --display-chars N     On-screen response limit (default 3000); full logs are retained\n` +
    `  --expected-tools N    Comparison only (default 44); actual count always comes from tools/list\n` +
    `  --allow-rejoin        Permit an existing key, explicitly labeled as a rejoin\n` +
    `  --max-wait-seconds N  Stop observing after this deadline, without canceling the native job\n\n` +
    `The studio and Comfy engine must already be running. This client does not start them.\n` +
    `Ctrl+C ends observation; it does not cancel, resubmit or change a generation.\n`);
}
if (argv.includes('--help') || !argv.length) { help(); process.exit(0); }
if (argv.includes('--run') === argv.includes('--dry-check')) throw Error('Choose exactly one of --run or --dry-check.');
const repo = path.resolve(option('--repo', 'E:/Aftertake/claude-jobs-20261020/repo'));
const output = path.resolve(option('--out', path.join(own, 'recording-b-mcp')));
const studio = new URL(option('--studio', 'http://127.0.0.1:4396'));
if (studio.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(studio.hostname) || studio.username || studio.password || studio.pathname !== '/' || studio.search || studio.hash)
  throw Error('Use a plain loopback HTTP studio URL.');
const requestId = option('--request-id', 'job4-hero-banner-mcp-20261020-v1');
if (!/^[a-zA-Z0-9_-]{1,80}$/.test(requestId)) throw Error('Invalid request ID.');
const seed = numberOption('--seed', 509074, 0, 2 ** 32 - 1);
const displayLimit = numberOption('--display-chars', 3000, 200, 1000000);
const expectedTools = numberOption('--expected-tools', 44, 1, 10000);
const pollMs = numberOption('--poll-ms', 2000, 250, 60000);
const readingPauseMs = numberOption('--reading-pause-ms', 0, 0, 60000);
const terminalRows = numberOption('--terminal-rows', 0, 0, 1000);
const terminalCols = numberOption('--terminal-cols', 0, 0, 1000);
const maxWait = numberOption('--max-wait-seconds', 900, 1, 86400) * 1000;
const resolution = option('--resolution', '720p');
if (!['720p', 'standard'].includes(resolution)) throw Error('Choose 720p or standard resolution.');
const expected = JSON.parse(fs.readFileSync(path.join(own, 'hero-banner.expected.json'), 'utf8'));
const moduleRequire = createRequire(path.join(repo, 'package.json'));
const esm = (name) => pathToFileURL(moduleRequire.resolve(name).replace(/\.cjs$/, '.mjs')).href;
const { Client } = await import(esm('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(esm('@modelcontextprotocol/client/stdio'));
const packageJson = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
if (packageJson.scripts?.mcp !== 'tsx server/mcp.ts') throw Error('Review the changed package.json mcp script before recording.');
const launcher = option('--launcher', argv.includes('--npm-cli') ? 'npm' : 'pnpm');
if (!['pnpm', 'npm'].includes(launcher)) throw Error('Choose pnpm or npm.');
const knownPnpm = 'C:/Users/Jay/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.mjs';
const launcherCli = path.resolve(launcher === 'npm' ? option('--npm-cli', path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')) : option('--pnpm-cli', knownPnpm));
const python = option('--python', 'C:/Users/Jay/Documents/ChatGPT/Comfy-Higgs/.runtime/film-venv/Scripts/python.exe');
const serverArguments = [launcherCli, '--silent', 'run', 'mcp', '--', '--url', studio.origin, '--state-dir', path.join(output, 'server-state'), '--media-root', repo, '--python', python];
const registrationFiles = ['server/mcp.ts', 'server/generation-tools.ts', 'server/character-tools.ts', 'server/effects-tools.ts', 'server/recomposition-tools.ts'];
const staticTools = registrationFiles.flatMap((file) => [...fs.readFileSync(path.join(repo, file), 'utf8').matchAll(/\btool\(\s*['"](aftertake_[a-z0-9_]+)['"]/g)].map((match) => ({ name: match[1], file })));
const uniqueTools = new Set(staticTools.map((tool) => tool.name));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
const starterSource = fs.readFileSync(path.join(repo, 'src/creative-recipes.ts'), 'utf8');
const workspaceSource = fs.readFileSync(path.join(repo, 'server/generation-tools.ts'), 'utf8');
const audit = {
  format: 'aftertake-recording-b-preparation/1', codeCommit: commit,
  sdk: '@modelcontextprotocol/client 2.3.1', sdkImportedWithoutConnection: true,
  staticLiteralToolCount: uniqueTools.size, staticCountIsNotLiveVerification: true,
  duplicateLiteralNames: staticTools.filter((tool, index) => staticTools.findIndex((first) => first.name === tool.name) !== index),
  staticToolNames: [...uniqueTools].sort(),
  starterIdInCurrentSource: starterSource.includes("id: 'hero-banner'"),
  starterPromptMatchesSnapshotInCurrentSource: starterSource.includes(expected.settings.prompt),
  workspaceStarterDiscoveryInCurrentSource: workspaceSource.includes('starters: Object.fromEntries'),
  launcher, launcherCli, launcherExists: fs.existsSync(launcherCli), packageScript: packageJson.scripts.mcp,
  requestId, seed, resolution, studio: studio.origin, readingPauseMs, terminalRows, terminalCols,
  executionBoundary: 'No MCP connection, service start, API request or generation has occurred during this dry check.',
};
if (argv.includes('--dry-check')) {
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(own, 'recording-b-preparation.audit.json'), JSON.stringify(audit, null, 2) + '\n');
  process.stdout.write(JSON.stringify(audit, null, 2) + '\n');
  if (!audit.launcherExists || !audit.starterIdInCurrentSource || !audit.starterPromptMatchesSnapshotInCurrentSource || !audit.workspaceStarterDiscoveryInCurrentSource) process.exitCode = 1;
  process.exit();
}
if (!audit.launcherExists) throw Error(`Launcher CLI does not exist: ${launcherCli}`);
if (!audit.starterIdInCurrentSource || !audit.starterPromptMatchesSnapshotInCurrentSource || !audit.workspaceStarterDiscoveryInCurrentSource)
  throw Error('Current app source does not expose the audited Hero banner starter. Update the intended proof branch before recording.');
fs.mkdirSync(output, { recursive: true });
const textPath = path.join(output, 'proof-mcp.txt');
const tracePath = path.join(output, 'proof-mcp.trace.json');
if (fs.existsSync(tracePath) && !argv.includes('--allow-rejoin')) throw Error('A proof trace already exists here. Preserve it; choose a new output folder or explicitly --allow-rejoin. The fixed request ID remains unchanged.');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
if (fs.existsSync(tracePath)) fs.copyFileSync(tracePath, path.join(output, `proof-mcp.trace.before-${runId}.json`));
const trace = { format: 'aftertake-live-mcp-proof/1', runId, audit, startedAt: new Date().toISOString(), events: [] };
const started = performance.now();
const signal = new AbortController();
let client, transport, gate, terminalRegionActive = false;
const screenGraphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
function screenWidth(grapheme) {
  if (/^\p{Mark}+$/u.test(grapheme)) return 0;
  if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(grapheme)) return 2;
  const code = grapheme.codePointAt(0);
  return code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) || (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1b000 && code <= 0x1b2ff) || (code >= 0x20000 && code <= 0x3fffd)) ? 2 : 1;
}
function wrapScreen(value) {
  if (!terminalCols) return value;
  return value.split(/\r?\n/).map((line) => {
    let wrapped = '', width = 0;
    for (const { segment } of screenGraphemes.segment(line)) {
      // Expand terminal tabs in the display only; the retained transcript stays exact.
      const content = segment === '\t' ? ' '.repeat(8 - (width % 8)) : segment;
      for (const { segment: piece } of screenGraphemes.segment(content)) {
        const cells = screenWidth(piece);
        if (width && width + cells > terminalCols) { wrapped += '\n'; width = 0; }
        wrapped += piece;
        width += cells;
      }
    }
    return wrapped;
  }).join('\n');
}
function restoreTerminalRegion() {
  if (terminalRegionActive) { process.stdout.write('\x1b[r'); terminalRegionActive = false; }
}
function stamp() { return { utc: new Date().toISOString(), elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(3)) }; }
function saveTrace() { fs.writeFileSync(tracePath + '.tmp', JSON.stringify(trace, null, 2) + '\n'); fs.renameSync(tracePath + '.tmp', tracePath); }
function record(type, data) { trace.events.push({ ...stamp(), type, data }); saveTrace(); }
function transcript(value) { fs.appendFileSync(textPath, value + '\n', 'utf8'); }
function display(value) { process.stdout.write(wrapScreen(String(value)) + '\n'); }
function both(value) { transcript(value); display(value); }
function displayResponse(value) {
  if (value.length <= displayLimit) display(value);
  else display(value.slice(0, displayLimit) + `\n[Display limited to ${displayLimit} characters. Complete response retained in proof-mcp.txt and proof-mcp.trace.json.]`);
}
async function before(label) {
  if (signal.signal.aborted) throw Error('Observation interrupted; native job has not been canceled.');
  if (argv.includes('--gated')) {
    gate ||= createInterface({ input: process.stdin, output: process.stdout });
    both(`[Manual reading gate before ${label}; this is not compute time.]`);
    await gate.question('Press Enter to make the real call. ', { signal: signal.signal });
  }
}
async function readingPause(label) {
  if (!readingPauseMs) return;
  both(`[Reading pause: ${readingPauseMs}ms after ${label}; this is not model compute time.]`);
  record('reading pause started', { after: label, requestedMilliseconds: readingPauseMs, purpose: 'Operator reading time, not model compute.' });
  await sleep(readingPauseMs, undefined, { signal: signal.signal });
  record('reading pause ended', { after: label });
}
function dataOf(result) {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const block = result.content?.find((part) => part.type === 'text');
  if (!block) throw Error('The real tool response contains no structured/text result.');
  return JSON.parse(block.text);
}
async function call(name, args) {
  await before(name);
  const callStarted = performance.now();
  const request = { name, arguments: args };
  both(`\n[${stamp().elapsedSeconds.toFixed(3)}s] MCP tools/call → ${name}\n${JSON.stringify(args, null, 2)}`);
  record('tools/call request', request);
  const result = await client.callTool(request, { timeout: 300000 });
  record('tools/call response', { name, callElapsedSeconds: Number(((performance.now() - callStarted) / 1000).toFixed(3)), result });
  transcript(`MCP response ← ${name}\n${JSON.stringify(result, null, 2)}`);
  const text = result.content?.filter((part) => part.type === 'text').map((part) => part.text).join('\n') || JSON.stringify(result.structuredContent, null, 2);
  displayResponse(`MCP response ← ${name}\n${text}`);
  for (const [index, part] of (result.content || []).entries()) if (part.type === 'image') {
    const bytes = Buffer.from(part.data, 'base64');
    const extension = part.mimeType === 'image/png' ? '.png' : part.mimeType === 'image/jpeg' ? '.jpg' : '.bin';
    const file = `mcp-inspection-${index + 1}${extension}`;
    fs.writeFileSync(path.join(output, file), bytes);
    both(`[Actual MCP image content: ${part.mimeType}, ${bytes.length} bytes; saved ${file}. Full base64 retained in the JSON trace.]`);
  }
  if (result.isError) throw Error(`Real MCP tool error from ${name}; see retained response.`);
  return dataOf(result);
}
process.once('SIGINT', () => { signal.abort(); gate?.close(); void client?.close(); });
process.once('exit', restoreTerminalRegion);
try {
  if (terminalRows) {
    if (!process.stdout.isTTY) throw Error('--terminal-rows requires a real interactive VT terminal. No MCP connection was opened.');
    terminalRegionActive = true;
    process.stdout.write(`\x1b[1;${terminalRows}r\x1b[1;1H`);
  }
  both(`\nAftertake — live MCP proof\nRun ${runId}\nCode ${commit}\nStudio ${studio.origin}\nLauncher: ${launcher} run mcp (silent lifecycle banner; MCP responses are unmodified)\nRequest ID: ${requestId}\nNo studio or Comfy engine is started by this client.`);
  record('run boundary', { launcher: process.execPath, args: serverArguments, cwd: repo });
  const inheritedPath = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  const serverEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && key.toLowerCase() !== 'path')), PATH: path.dirname(process.execPath) + path.delimiter + inheritedPath, AFTERTAKE_STUDIO_URL: studio.origin, AFTERTAKE_PYTHON: python, pnpm_config_pm_on_fail: 'ignore' };
  transport = new StdioClientTransport({ command: process.execPath, args: serverArguments, cwd: repo, stderr: 'pipe', env: serverEnv });
  transport.stderr?.on('data', (chunk) => { const text = chunk.toString(); fs.appendFileSync(path.join(output, 'mcp-server.stderr.log'), text); record('server stderr', { text }); });
  client = new Client({ name: 'aftertake-live-proof-recorder', version: '1.0.0' });
  await before('MCP connection');
  record('connect request', { transport: 'stdio', launcher });
  await client.connect(transport, { timeout: 60000 });
  record('connect response', { connected: true, serverPid: transport.pid, serverVersion: client.getServerVersion?.(), capabilities: client.getServerCapabilities?.() });
  both('Connected to the real Aftertake stdio MCP server.');
  await before('tools/list');
  record('tools/list request', {});
  const listing = await client.listTools();
  record('tools/list response', listing);
  transcript(`MCP tools/list full response\n${JSON.stringify(listing, null, 2)}`);
  const names = listing.tools.map((tool) => tool.name);
  const listRows = Math.ceil(names.length / 2);
  const columnWidth = Math.max(0, ...names.map((name) => name.length)) + 4;
  const columns = Array.from({ length: listRows }, (_, row) =>
    names[row].padEnd(columnWidth) + (names[row + listRows] || ''),
  ).join('\n');
  both(`Actual tools/list count: ${names.length}\n${columns}\nActual tool count returned by this server: ${names.length}`);
  if (names.length !== expectedTools) both(`Count differs from the expected ${expectedTools}: the observed count is ${names.length}. Do not label this recording as ${expectedTools} tools.`);
  await readingPause('the actual tools/list response');
  for (const required of ['aftertake_generation_workspace', 'aftertake_generate_image', 'aftertake_generation_status', 'aftertake_inspect_picture']) if (!names.includes(required)) throw Error(`Missing real MCP capability: ${required}`);
  const workspace = await call('aftertake_generation_workspace', { query: '', limit: 50, profile: 'image-gen' });
  const hero = workspace.starters?.image?.find((starter) => starter.id === expected.id);
  if (hero) both(`Actual aftertake_generation_workspace response excerpt — image starter:\n${JSON.stringify({ id: hero.id, label: hero.label, settings: hero.settings }, null, 2)}\n[This excerpt comes from the live response. The complete response is retained in proof-mcp.txt and proof-mcp.trace.json.]`);
  if (!hero || hero.label !== expected.label || !isDeepStrictEqual(hero.settings, expected.settings)) throw Error('The live Hero banner starter is absent or differs from the audited application starter. No generation submitted.');
  if (workspace.engine?.ready !== true) throw Error('The real image-generation engine is not ready. No generation submitted.');
  both(`Verified live starter: ${hero.label} (${hero.id}); exact application prompt, style and direction retained.`);
  await readingPause('the live workspace and verified Hero banner starter');
  const existing = await call('aftertake_generation_status', { kind: 'image', requestId, includeWorkflow: false });
  const isRejoin = existing.state !== 'not_found';
  if (isRejoin && !argv.includes('--allow-rejoin')) throw Error('This fixed request ID already exists. No new generation submitted. Resume explicitly with --allow-rejoin, and label the recording as a rejoin.');
  if (isRejoin) both(`REJOIN: native operation already exists in state ${existing.state}. This is not a fresh generation.`);
  const request = { format: 'aftertake-image/1', name: option('--name', 'Hero banner - MCP proof'), aspect: 'landscape', seed, ...(resolution === '720p' ? { resolution } : {}), ...structuredClone(hero.settings) };
  fs.writeFileSync(path.join(output, 'hero-banner.request.json'), JSON.stringify(request, null, 2) + '\n');
  record('verified selected starter', { hero, request, requestId, isRejoin });
  const generationStarted = performance.now();
  let status = await call('aftertake_generate_image', { requestId, request });
  await readingPause('the actual generation admission response');
  const originalId = status.id;
  const terminal = new Set(['failed', 'canceled', 'expired', 'output_error', 'connection_lost', 'submission_unknown', 'not_found']);
  while (status.state !== 'succeeded') {
    if (terminal.has(status.state)) throw Error(`Native operation reached ${status.state}. Its inputs and key are retained; no automatic reconciliation, cancellation or resubmission occurred.`);
    if (performance.now() - generationStarted > maxWait) throw Error('Observation deadline reached. The native job may continue; it was not canceled or resubmitted.');
    both(`[Waiting for native job ${originalId}; last actual state ${status.state}; observation ${(performance.now() - generationStarted) / 1000 | 0}s. Next status poll in ${pollMs}ms.]`);
    await sleep(pollMs, undefined, { signal: signal.signal });
    status = await call('aftertake_generation_status', { kind: 'image', requestId, includeWorkflow: false });
    if (status.id && status.id !== originalId) throw Error('Status returned a different native generation ID.');
  }
  if (!status.clip?.id || !/^[a-f0-9]{64}$/.test(status.clip.sha256 || '')) throw Error('Succeeded response lacks a hash-bound native source clip.');
  const final = await call('aftertake_generation_status', { kind: 'image', requestId, includeWorkflow: true });
  if (!isDeepStrictEqual(final.request, request)) throw Error('The completed native request differs from the submitted Hero banner request.');
  await readingPause('the actual completed generation response');
  const inspection = await call('aftertake_inspect_picture', { clipId: status.clip.id, sha256: status.clip.sha256, times: [0] });
  if (inspection.sha256 !== status.clip.sha256) throw Error('Inspected source differs from the generated native source.');
  await readingPause('the actual MCP picture inspection response');
  const receipt = { format: 'aftertake-recording-b-receipt/1', runId, codeCommit: commit, observedToolCount: names.length, expectedToolCount: expectedTools, requestId, request, nativeId: final.id, nativeJobId: final.jobId, clip: final.clip, inspectedSha256: inspection.sha256, isRejoin, observationSeconds: Number(((performance.now() - generationStarted) / 1000).toFixed(3)), timingScope: 'Wall time includes actual MCP calls, polling, and any explicitly labeled manual reading gates; this is not a kernel benchmark.', workflow: final.workflow, completedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(output, 'proof-mcp.receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  record('completed receipt', receipt);
  both(`\nReal native generation and MCP inspection complete.\nClip: ${final.clip.id}\nSHA256: ${inspection.sha256}\nObserved tools: ${names.length}\nFull evidence: proof-mcp.txt, proof-mcp.trace.json, proof-mcp.receipt.json\nVisual quality still requires viewing the actual image.`);
} catch (error) {
  record('failure', { message: error instanceof Error ? error.message : String(error), nativeJobNotCanceled: true });
  both(`\nStopped: ${error instanceof Error ? error.message : String(error)}\nNo automatic cancellation or new request ID was used.`);
  process.exitCode = signal.signal.aborted ? 130 : 1;
} finally {
  restoreTerminalRegion();
  gate?.close();
  await client?.close().catch(() => {});
  trace.finishedAt = new Date().toISOString();
  saveTrace();
}
