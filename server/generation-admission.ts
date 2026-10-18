import { RequestError } from './http-errors.js';
import { contentDigest } from './edit-plan.js';

export type GenerationIdentity = { requestKey?: string; requestDigest?: string };

/** Bind a caller's stable key before admission or any SDK/network work. */
export function generationAdmission<T extends GenerationIdentity>(
  key: string | undefined,
  input: unknown,
  records: Iterable<T>,
) {
  if (key !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(key))
    throw new RequestError(
      'Use a generation key of 1–128 letters, digits, underscores or hyphens.',
    );
  const identity: GenerationIdentity =
    key !== undefined ? { requestKey: key, requestDigest: contentDigest(input) } : {};
  const existing = key ? [...records].find((record) => record.requestKey === key) : undefined;
  return {
    identity,
    existing,
    conflict: !!existing && existing.requestDigest !== identity.requestDigest,
  };
}
export const generationKeyConflict =
  'That generation key belongs to different inputs. Use the original request to rejoin it, or a new key for a deliberate revision.';
