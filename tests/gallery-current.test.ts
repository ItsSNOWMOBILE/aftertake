import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { recipeSchema } from '../src/domain.js';
import { buildWorkflow } from '../server/workflow.js';
import { inspectVideoMetadata } from '../server/video-metadata.js';

const examples = fileURLToPath(new URL('../examples/', import.meta.url));

// Upload names and SDK annotations vary between runs. Model names, node types,
// precision, decoder, guidance, compositing and output geometry must still match.
function executionSettings(graph: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(graph).map(([id, value]) => {
      const node = value as { class_type: string; inputs: Record<string, unknown> };
      return [
        id,
        {
          class_type: node.class_type,
          inputs: Object.fromEntries(
            Object.entries(node.inputs).filter(
              ([key, input]) =>
                !['filename', 'file', 'filename_prefix', 'recipe_json'].includes(key) &&
                !(key === 'image' && typeof input === 'string'),
            ),
          ),
        },
      ];
    }),
  );
}

test('published workflow previews use final settings and the current executed pipeline', async () => {
  const manifest = JSON.parse(await readFile(path.join(examples, 'manifest.json'), 'utf8'));
  for (const item of manifest.cases) {
    const recipe = recipeSchema.parse(
      JSON.parse(await readFile(path.join(examples, item.recipe), 'utf8')),
    );
    const recorded = JSON.parse(await readFile(path.join(examples, item.workflow), 'utf8'));
    const media = inspectVideoMetadata(await readFile(path.join(examples, item.result)), recipe);
    assert.equal(recipe.quality, 'final', `${item.slug} must not silently revert to a draft`);
    assert.deepEqual(media.workflow, recorded, `${item.slug} must retain its executed MP4 graph`);
    assert.deepEqual(
      executionSettings(recorded),
      executionSettings(buildWorkflow(recipe)),
      `${item.slug} is stale after a pipeline change; regenerate and review the example`,
    );
  }
});
