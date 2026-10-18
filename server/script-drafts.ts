import { Router } from 'express';
import { mkdir, readFile, writeFile, rename, readdir, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  scriptRequestSchema,
  checkedScriptResult,
  scriptRevision,
  scriptModelRevision,
  type ScriptDraft,
} from '../src/script-draft.js';
import { contentDigest } from './edit-plan.js';

const exec = promisify(execFile),
  uuid = /^[a-f0-9-]{36}$/;
export async function scriptDraftRouter(context: {
  root: string;
  data: string;
  ready?: () => Promise<boolean>;
  run?: (requestFile: string, outputFile: string) => Promise<void>;
}) {
  const { root, data } = context,
    folder = path.join(data, 'script-drafts'),
    router = Router(),
    jobs = new Map<string, ScriptDraft>(),
    active = new Set<string>();
  const python =
    process.env.AFTERTAKE_SCRIPT_PYTHON ||
    path.join(
      root,
      '.runtime/script-venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    );
  const models = process.env.AFTERTAKE_SCRIPT_MODEL || path.join(root, '.runtime/script-model');
  await mkdir(folder, { recursive: true });
  let admitting = false;
  const ready =
    context.ready ||
    (async () =>
      !!(await stat(python).catch(() => null)) &&
      !!(await stat(path.join(models, 'openvino_model.bin')).catch(() => null)));
  async function persist(job: ScriptDraft) {
    job.updatedAt = new Date().toISOString();
    const target = path.join(folder, job.id + '.json'),
      tmp = target + '.' + randomUUID() + '.tmp';
    await writeFile(tmp, JSON.stringify(job, null, 2));
    await rename(tmp, target);
  }
  const collecting = new Map<string, Promise<void>>();
  async function collectOutput(job: ScriptDraft) {
    if (job.state === 'ready' || job.state === 'failed') return;
    let output: any;
    try {
      output = JSON.parse(await readFile(path.join(folder, job.id + '.output.json'), 'utf8'));
    } catch (error: any) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (output.requestDigest !== job.requestDigest)
      throw Error('The saved script result belongs to a different request.');
    if (output.error) {
      job.state = 'failed';
      job.error = String(output.error).slice(0, 1000);
    } else {
      job.result = checkedScriptResult(output.result, job.request);
      job.state = 'ready';
      delete job.error;
    }
    await persist(job);
  }
  async function collect(job: ScriptDraft) {
    const pending = collecting.get(job.id);
    if (pending) return pending;
    const work = collectOutput(job);
    collecting.set(job.id, work);
    try {
      await work;
    } finally {
      if (collecting.get(job.id) === work) collecting.delete(job.id);
    }
  }
  const run =
    context.run ||
    (async (requestFile: string, outputFile: string) => {
      await exec(
        python,
        [path.join(root, 'scripts/draft-script.py'), requestFile, outputFile, '--models', models],
        { timeout: 240000, maxBuffer: 1024 * 1024, windowsHide: true },
      );
    });
  async function start(job: ScriptDraft) {
    if (active.has(job.id)) return;
    active.add(job.id);
    try {
      const requestFile = path.join(folder, job.id + '.request.json'),
        outputFile = path.join(folder, job.id + '.output.json');
      job.state = 'drafting';
      delete job.error;
      await persist(job);
      await writeFile(
        requestFile,
        JSON.stringify({ requestDigest: job.requestDigest, request: job.request }),
      );
      await run(requestFile, outputFile);
      await collect(job);
      if (job.state === 'drafting') throw Error('The local script process ended without a result.');
    } catch (error) {
      job.state = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      await persist(job);
    } finally {
      active.delete(job.id);
    }
  }
  for (const name of await readdir(folder)) {
    if (!name.endsWith('.json') || !uuid.test(name.slice(0, -5))) continue;
    const job = JSON.parse(await readFile(path.join(folder, name), 'utf8')) as ScriptDraft;
    job.request = scriptRequestSchema.parse(job.request);
    jobs.set(job.id, job);
    if (job.state === 'drafting') {
      job.state = 'interrupted';
      job.error =
        'The studio restarted during this draft. Rejoin its original request to collect or resume it.';
      await persist(job);
    }
    await collect(job);
  }
  router.get('/health', async (_req, res) =>
    res.json({
      ready: await ready(),
      model: 'Qwen3-4B / OpenVINO INT4',
      device: 'CPU',
      setup: 'python scripts/setup-script.py',
    }),
  );
  router.get('/', async (_req, res) => {
    for (const job of jobs.values()) await collect(job);
    res.json([...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  });
  router.post('/', async (req, res) => {
    const request = scriptRequestSchema.parse(req.body),
      digest = contentDigest({ revision: scriptRevision, model: scriptModelRevision, request });
    const found = [...jobs.values()].find((job) => job.requestDigest === digest);
    if (found) {
      await collect(found);
      return void res
        .status(found.state === 'ready' || found.state === 'failed' ? 200 : 202)
        .json(found);
    }
    if (
      admitting ||
      [...jobs.values()].some((job) => job.state === 'drafting' || job.state === 'interrupted')
    )
      return void res.status(409).json({
        error: 'A local script is already drafting. Rejoin it before requesting another version.',
      });
    admitting = true;
    try {
      if (!(await ready()))
        return void res.status(409).json({
          error: 'Install the optional local script model with python scripts/setup-script.py.',
        });
      // Publish the content-bound record synchronously, before any process work.
      const job: ScriptDraft = {
        id: randomUUID(),
        requestDigest: digest,
        request,
        state: 'drafting',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      jobs.set(job.id, job);
      await persist(job);
      void start(job);
      res.status(202).json(job);
    } finally {
      admitting = false;
    }
  });
  router.get('/:id', async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return void res.status(404).json({ error: 'Script draft not found.' });
    await collect(job);
    res.json(job);
  });
  router.post('/:id/reconcile', async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return void res.status(404).json({ error: 'Script draft not found.' });
    await collect(job);
    if (job.state === 'ready' || job.state === 'failed' || active.has(job.id))
      return void res.json(job);
    if (!(await ready()))
      return void res.status(409).json({
        error:
          'The original local script runtime is unavailable. Keep this draft until it can be rejoined.',
      });
    void start(job);
    res.status(202).json(job);
  });
  return router;
}
