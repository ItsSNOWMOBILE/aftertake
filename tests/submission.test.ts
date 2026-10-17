import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, InvalidWorkflow, QueueFull } from '@comfyorg/sdk/low';
import { ComfyError } from '@comfyorg/sdk';
import { submissionRejected } from '../server/submission.js';

test('definite admission rejections can be corrected, while ambiguous submissions stay blocked', () => {
  assert.equal(submissionRejected(new InvalidWorkflow('Missing bypass input', { httpStatus: 400 })), true);
  assert.equal(submissionRejected(new ComfyError('Missing bypass input', { code: 'invalid_workflow', httpStatus: 400 })), true);
  assert.equal(submissionRejected(new ComfyError('Unknown server failure')), false);
  assert.equal(submissionRejected(new QueueFull('Full', { httpStatus: 429 })), true);
  assert.equal(submissionRejected(new Error('Connection reset after submit')), false);
  assert.equal(submissionRejected(new ApiError('Timeout', { httpStatus: 504, code: 'error' })), false);
  assert.equal(submissionRejected(new ApiError('Key reused', { httpStatus: 409, code: 'idempotency_key_reuse' })), false);
});
