import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
const file = 'E:/Aftertake/claude-jobs-20261020/job4/proof-render.workflow-api.json';
const bytes = fs.readFileSync(file);
const graph = JSON.parse(bytes);
const hash = createHash('sha256').update(bytes).digest('hex');
process.stdout.write('\x1b[1;29r\x1b[H\x1b[2J');
try {
  console.log('AFTERTAKE / authentic exported workflow');
  console.log('proof-render.workflow-api.json');
  console.log(`SHA256 ${hash}`);
  console.log(`Read-only terminal inspection of ${Object.keys(graph).length} submitted nodes. No inference or edits.`);
  await wait(1800);
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    for (let i = 0; i < Math.max(1, line.length); i += 108) console.log(line.slice(i, i + 108));
    await wait(100);
  }
  console.log('\nOriginal downloaded JSON inspection complete.');
  console.log(`SHA256 ${hash}`);
  await wait(2500);
} finally { process.stdout.write('\x1b[r'); }
