import { ZodError } from 'zod';
import type { ErrorRequestHandler } from 'express';
import { RecipeAssetError } from './assets.js';

/** An intentional client-facing failure. Internal exception text stays in logs. */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const handleRequestError: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof RequestError) {
    res.status(error.status).json({ error: error.message });
  } else if (error instanceof ZodError) {
    res.status(400).json({ error: error.issues[0]?.message || 'Check the project settings.' });
  } else if (error instanceof RecipeAssetError) {
    res.status(409).json({ error: error.message });
  } else if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
    res.status(404).json({ error: 'The requested media or project was not found.' });
  } else if ((error as { type?: string })?.type === 'entity.too.large') {
    res.status(413).json({ error: 'This upload exceeds the allowed size.' });
  } else if ((error as { type?: string })?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Send a valid JSON request.' });
  } else {
    console.error('Studio request failed:', error);
    res
      .status(500)
      .json({ error: 'The studio could not complete this request. Check its terminal log.' });
  }
};
