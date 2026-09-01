export interface ModelErrorInfo {
  status?: number;
  code?: string;
  message: string;
  retryAfterMs?: number;
}

export interface ModelAttempt {
  model: string;
  error: ModelErrorInfo;
}

export interface ModelFallbackOptions {
  /** Long daily resets should remain recoverable instead of blocking the job for hours. */
  maxRateLimitWaitMs?: number;
  /** Number of short reset waits allowed for one model-pool operation. */
  maxRateLimitRetries?: number;
  onWait?: (waitMs: number, attempts: ModelAttempt[]) => void;
  wait?: (waitMs: number) => Promise<void>;
}

const FALLBACK_STATUS_CODES = new Set([404, 408, 409, 429]);
const FALLBACK_ERROR_CODES = new Set([
  'model_not_found',
  'rate_limit_exceeded',
  'request_timeout',
  'service_unavailable',
  'invalid_model_output',
]);

export class ModelPoolExhaustedError extends Error {
  readonly attempts: ModelAttempt[];
  readonly rateLimited: boolean;

  constructor(label: string, attempts: ModelAttempt[]) {
    const rateLimited = attempts.some(attempt =>
      attempt.error.status === 429 || attempt.error.code === 'rate_limit_exceeded'
    );
    const models = attempts.map(attempt => attempt.model).join(', ');
    const retryAfterMs = attempts
      .map(attempt => attempt.error.retryAfterMs)
      .filter((value): value is number => typeof value === 'number' && value >= 0)
      .sort((a, b) => a - b)[0];
    const resetText = retryAfterMs !== undefined
      ? ` The shortest reported reset is about ${Math.max(1, Math.ceil(retryAfterMs / 1000))} seconds.`
      : '';
    const message = rateLimited
      ? `All configured free Groq ${label} models are currently rate-limited.${resetText} Completed cards have been saved; no paid model was used.`
      : `No configured Groq ${label} model is currently available (${models}).`;

    super(message);
    this.name = 'ModelPoolExhaustedError';
    this.attempts = attempts;
    this.rateLimited = rateLimited;
  }
}

export function parseModelList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map(model => model.trim())
    .filter(Boolean);
}

export function buildModelPool(
  configuredList: string | undefined,
  legacyModel: string | undefined,
  defaults: string[]
): string[] {
  const configured = parseModelList(configuredList);
  const legacy = legacyModel?.trim();
  const models = configured.length > 0
    ? [...configured, ...defaults]
    : legacy
      ? [legacy, ...defaults]
      : defaults;

  return [...new Set(models)];
}

export function getModelErrorInfo(error: unknown): ModelErrorInfo {
  const candidate = error as {
    status?: number;
    statusCode?: number;
    code?: string;
    message?: string;
    error?: { code?: string; message?: string };
    response?: { status?: number; data?: { error?: { code?: string; message?: string } } };
    headers?: Headers | Record<string, string | string[] | undefined>;
  };
  const nested = candidate?.error ?? candidate?.response?.data?.error;

  const getHeader = (name: string): string | undefined => {
    const headers = candidate?.headers;
    if (!headers) return undefined;
    if (typeof (headers as Headers).get === 'function') {
      return (headers as Headers).get(name) ?? undefined;
    }
    const record = headers as Record<string, string | string[] | undefined>;
    const value = record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];
    return Array.isArray(value) ? value[0] : value;
  };

  const parseDurationMs = (value: string | undefined): number | undefined => {
    if (!value) return undefined;
    if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
      return Math.ceil(Number(value) * 1000);
    }
    const match = value.trim().match(/^(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/i);
    if (!match) return undefined;
    const minutes = Number(match[1] ?? 0);
    const seconds = Number(match[2] ?? 0);
    return Math.ceil((minutes * 60 + seconds) * 1000);
  };

  const retryAfterMs = parseDurationMs(getHeader('retry-after'))
    ?? parseDurationMs(getHeader('x-ratelimit-reset-tokens'));

  return {
    status: candidate?.status ?? candidate?.statusCode ?? candidate?.response?.status,
    code: candidate?.code ?? nested?.code,
    message: nested?.message ?? candidate?.message ?? String(error),
    retryAfterMs,
  };
}

export function canTryAnotherModel(error: unknown): boolean {
  const info = getModelErrorInfo(error);
  if (info.status !== undefined && (FALLBACK_STATUS_CODES.has(info.status) || info.status >= 500)) {
    return true;
  }
  return info.code !== undefined && FALLBACK_ERROR_CODES.has(info.code);
}

export function isModelPoolExhausted(error: unknown): error is ModelPoolExhaustedError {
  return error instanceof ModelPoolExhaustedError;
}

export async function runWithModelFallback<T>(
  models: string[],
  operation: (model: string) => Promise<T>,
  label: string,
  onFallback?: (fromModel: string, toModel: string, error: ModelErrorInfo) => void,
  options: ModelFallbackOptions = {}
): Promise<T> {
  if (models.length === 0) {
    throw new Error(`No Groq ${label} models are configured.`);
  }

  const attempts: ModelAttempt[] = [];
  const maxWaitMs = options.maxRateLimitWaitMs ?? 65_000;
  const maxRateLimitRetries = options.maxRateLimitRetries ?? 2;
  const wait = options.wait ?? (waitMs => new Promise(resolve => setTimeout(resolve, waitMs)));

  for (let retry = 0; retry <= maxRateLimitRetries; retry++) {
    const cycleAttempts: ModelAttempt[] = [];
    for (let index = 0; index < models.length; index++) {
      const model = models[index];
      try {
        return await operation(model);
      } catch (error) {
        if (!canTryAnotherModel(error)) throw error;

        const info = getModelErrorInfo(error);
        const attempt = { model, error: info };
        attempts.push(attempt);
        cycleAttempts.push(attempt);
        const nextModel = models[index + 1];
        if (nextModel) onFallback?.(model, nextModel, info);
      }
    }

    const retryDelays = cycleAttempts
      .filter(attempt =>
        attempt.error.status === 429 || attempt.error.code === 'rate_limit_exceeded'
      )
      .map(attempt => attempt.error.retryAfterMs)
      .filter((value): value is number => typeof value === 'number' && value >= 0)
      .sort((a, b) => a - b);

    if (retry < maxRateLimitRetries && retryDelays.length > 0) {
      // Retry shortly after the first model becomes available. Add a small
      // buffer because API reset headers can round down to the nearest second.
      const waitMs = retryDelays[0] + 250;
      if (waitMs <= maxWaitMs) {
        options.onWait?.(waitMs, cycleAttempts);
        await wait(waitMs);
        continue;
      }
    }

    break;
  }

  throw new ModelPoolExhaustedError(label, attempts);
}
