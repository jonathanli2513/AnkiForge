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
