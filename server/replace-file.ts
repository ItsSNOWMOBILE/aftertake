import { rename } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// Windows refuses to replace a file while another process briefly holds it open,
// such as an antivirus scan, the search indexer or a reader of the old copy.
const busy = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * Move `source` over `target` in one step, as the studio does to save records.
 * On Windows a busy target is retried for a few seconds before the error surfaces.
 */
export async function replaceFile(
  source: string,
  target: string,
  { platform = process.platform, attempts = 9 } = {},
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(source, target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (platform !== 'win32' || !busy.has(code) || attempt >= attempts) throw error;
      await delay(Math.min(25 * 2 ** (attempt - 1), 1000));
    }
  }
}
