// Inspect saved Comfy metadata. This command never connects to an engine.
import { parseArgs } from 'node:util';
import { open, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { computeFeatures, type ComputeFeature } from '../src/compute.js';
import { requirements } from '../server/workflow.js';
import { evaluateEngineCompatibility } from '../server/engine-compatibility.js';

const metadataLimit = 16 * 1024 * 1024;
const statsLimit = 1024 * 1024;
const usage = `Check saved Comfy metadata without connecting to an engine or generating.

pnpm exec tsx scripts/check-engine-readiness.mts \\
  --feature character-swap --object-info .runtime/cloud/object-info.json \\
  --system-stats .runtime/cloud/system-stats.json \\
  --output .runtime/cloud/character-swap-check.json

--feature       ${computeFeatures.join(', ')} or all (default: all)
--object-info   Saved object_info JSON, at most 16 MiB (required)
--system-stats  Saved system_stats JSON, at most 1 MiB (optional)
--output        Write a new UTF-8 report; existing files are never overwritten

Without --output, the report is printed to stdout.
Exit status: 0 profile checks pass; 1 checks blocked; 2 invalid input or output.
A passing report does not enable rendering or certify a cloud deployment.
`;

class ReadinessInputError extends Error {}

/** Pure validation: reject explicit network/device namespaces before disk I/O. */
export function validateReadinessDiskPath(filename: string) {
  for (const value of [filename, path.resolve(filename)]) {
    const normalized = value.replace(/\\/g, '/').toLowerCase();
    if (
      normalized.startsWith('//') ||
      normalized.startsWith('/??/') ||
      normalized.startsWith('/device/') ||
      (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value))
    )
      throw new ReadinessInputError(
        'Use disk paths without URLs, network shares or device namespaces.',
      );
  }
}

async function snapshot(filename: string, limit: number, label: string) {
  let file;
  try {
    file = await open(filename, 'r');
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit)
      throw new ReadinessInputError(`${label} must be a JSON file within its size limit.`);
    // Bound the actual read too, including a file that grows after stat().
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit)
      throw new ReadinessInputError(`${label} must be a JSON file within its size limit.`);
    const bytes = buffer.subarray(0, length);
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    } catch {
      throw new ReadinessInputError(`${label} must contain valid JSON.`);
    }
    return {
      value,
      evidence: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: length },
    };
  } catch (error) {
    if (error instanceof ReadinessInputError) throw error;
    // Filesystem errors can contain personal paths. Do not echo them.
    throw new ReadinessInputError(`${label} could not be read.`);
  } finally {
    await file?.close();
  }
}

async function main() {
  let options;
  try {
    options = parseArgs({
      options: {
        feature: { type: 'string', default: 'all' },
        'object-info': { type: 'string' },
        'system-stats': { type: 'string' },
        output: { type: 'string' },
        help: { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch {
    throw new ReadinessInputError('Invalid arguments. Use --help for the supported options.');
  }
  if (options.help) {
    process.stdout.write(usage);
    return 0;
  }
  const selected = options.feature;
  if (
    !options['object-info'] ||
    (selected !== 'all' && !computeFeatures.includes(selected as ComputeFeature)) ||
    options.output === '' ||
    options['system-stats'] === ''
  )
    throw new ReadinessInputError('Choose a supported feature and a saved --object-info file.');

  // Validate every supplied path first, including output, before reading inputs.
  for (const filename of [options['object-info'], options['system-stats'], options.output])
    if (filename) validateReadinessDiskPath(filename);

  const objectInfo = await snapshot(options['object-info'], metadataLimit, 'Object metadata');
  const systemStats = options['system-stats']
    ? await snapshot(options['system-stats'], statsLimit, 'System metadata')
    : undefined;
  const features = selected === 'all' ? computeFeatures : [selected as ComputeFeature];
  const results = features.map((feature) => {
    const evaluation = evaluateEngineCompatibility({
      feature,
      objectInfo: objectInfo.value,
      systemStats: systemStats?.value,
    });
    return {
      feature,
      profileChecksPassed: evaluation.compatible,
      contractSha256: createHash('sha256')
        .update(JSON.stringify(requirements(feature)))
        .digest('hex'),
      missing: evaluation.missing,
      checks: evaluation.checks,
    };
  });
  const blocked = results.filter((result) => !result.profileChecksPassed).length;
  const report = {
    format: 'aftertake-engine-readiness/1',
    checkedAt: new Date().toISOString(),
    scope: 'Saved metadata and current profile requirements only.',
    inputs: { objectInfo: objectInfo.evidence, systemStats: systemStats?.evidence ?? null },
    summary: { checked: results.length, passed: results.length - blocked, blocked },
    results,
    generationReady: false,
    actions: { engineRequests: 0, submittedJobs: 0, changedConnections: 0 },
    unverified: [
      'Metadata origin and freshness, including whether it came from the intended worker.',
      'Model content hashes, GPU capacity, Linux dependencies and codec execution.',
      'Full graph validation, media transport, successful output and remote job recovery.',
      'Provider authentication, subscription, available credits and billing ownership.',
    ],
  };
  const json = JSON.stringify(report, null, 2) + '\n';
  if (options.output) {
    try {
      await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
      await writeFile(options.output, json, { encoding: 'utf8', flag: 'wx' });
    } catch {
      throw new ReadinessInputError(
        'The report could not be created. Choose a writable path that does not already exist.',
      );
    }
    process.stdout.write(
      JSON.stringify({ written: true, ...report.summary, generationReady: false }) + '\n',
    );
  } else {
    process.stdout.write(json);
  }
  return blocked ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(
      (error instanceof ReadinessInputError ? error.message : 'The readiness check failed.') + '\n',
    );
    process.exitCode = 2;
  }
}
