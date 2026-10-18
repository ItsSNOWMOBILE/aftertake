import path from 'node:path';
import { stat } from 'node:fs/promises';

export async function loadWorkspaceEnvironment(root: string, load = process.loadEnvFile) {
  const file = path.join(root, '.env');
  if (load && (await stat(file).catch(() => null))?.isFile()) load(file);
}
