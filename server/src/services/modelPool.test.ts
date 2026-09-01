import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ModelPoolExhaustedError,
  buildModelPool,
  getModelErrorInfo,
  runWithModelFallback,
} from './modelPool';

test('buildModelPool uses efficient defaults and removes duplicates', () => {
  assert.deepEqual(
    buildModelPool(undefined, undefined, ['small', 'medium', 'large', 'small']),
    ['small', 'medium', 'large']
  );
});

test('buildModelPool keeps a configured model first and retains fallbacks', () => {
  assert.deepEqual(
    buildModelPool(undefined, 'custom', ['small', 'custom', 'large']),
    ['custom', 'small', 'large']
  );
});

test('runWithModelFallback advances after a rate limit', async () => {
  const attempted: string[] = [];
  const result = await runWithModelFallback(
    ['small', 'large'],
    async model => {
      attempted.push(model);
      if (model === 'small') throw { status: 429, error: { code: 'rate_limit_exceeded', message: 'limit' } };
      return 'cards';
    },
    'text'
  );

  assert.equal(result, 'cards');
  assert.deepEqual(attempted, ['small', 'large']);
});

test('runWithModelFallback advances after malformed model output', async () => {
  const attempted: string[] = [];
  const result = await runWithModelFallback(
    ['small', 'large'],
    async model => {
      attempted.push(model);
      if (model === 'small') throw { code: 'invalid_model_output', message: 'bad JSON' };
      return 'valid cards';
    },
    'text'
  );

  assert.equal(result, 'valid cards');
  assert.deepEqual(attempted, ['small', 'large']);
});

test('getModelErrorInfo reads Groq retry-after headers', () => {
  const info = getModelErrorInfo({
    status: 429,
    headers: { 'retry-after': '2.5' },
    error: { code: 'rate_limit_exceeded', message: 'slow down' },
  });

  assert.equal(info.retryAfterMs, 2500);
});

test('runWithModelFallback waits for a short reset and retries the free pool', async () => {
  const attempted: string[] = [];
  const waits: number[] = [];
  let reset = false;

  const result = await runWithModelFallback(
    ['small', 'large'],
    async model => {
      attempted.push(model);
      if (!reset) {
        throw {
          status: 429,
          headers: { 'retry-after': model === 'small' ? '2' : '1' },
          error: { code: 'rate_limit_exceeded', message: 'temporary limit' },
        };
      }
      return `${model}-cards`;
    },
    'text',
    undefined,
    {
      wait: async waitMs => {
        waits.push(waitMs);
        reset = true;
      },
    }
  );

  assert.equal(result, 'small-cards');
  assert.deepEqual(attempted, ['small', 'large', 'small']);
  assert.deepEqual(waits, [1250]);
});

test('runWithModelFallback does not block for a long daily reset', async () => {
  let waited = false;
  await assert.rejects(
    runWithModelFallback(
      ['small', 'large'],
      async () => {
        throw {
          status: 429,
          headers: { 'retry-after': '7200' },
          error: { code: 'rate_limit_exceeded', message: 'daily limit' },
        };
      },
      'text',
      undefined,
      { wait: async () => { waited = true; } }
    ),
    (error: unknown) => error instanceof ModelPoolExhaustedError && error.rateLimited
  );
  assert.equal(waited, false);
});

test('runWithModelFallback does not hide authentication errors', async () => {
  await assert.rejects(
    runWithModelFallback(
      ['small', 'large'],
      async () => { throw { status: 401, message: 'bad key' }; },
      'text'
    ),
    (error: unknown) => getModelErrorInfo(error).status === 401
  );
});

test('runWithModelFallback reports an exhausted free pool', async () => {
  await assert.rejects(
    runWithModelFallback(
      ['small', 'large'],
      async () => { throw { status: 429, code: 'rate_limit_exceeded', message: 'limit' }; },
      'text'
    ),
    (error: unknown) => error instanceof ModelPoolExhaustedError && error.rateLimited
  );
});
