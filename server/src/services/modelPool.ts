export interface ModelErrorInfo {
  status?: number;
  code?: string;
  message: string;
}

export interface ModelAttempt {
  model: string;
  error: ModelErrorInfo;
}

const FALLBACK_STATUS_CODES = new Set([404, 408, 409, 429]);
const FALLBACK_ERROR_CODES = new Set([
  'model_not_found',
  'rate_limit_exceeded',
  'request_timeout',
  'service_unavailable',
]);

export class ModelPoolExhaustedError extends Error {
  readonly attempts: ModelAttempt[];
  readonly rateLimited: boolean;

  constructor(label: string, attempts: ModelAttempt[]) {
    const rateLimited = attempts.some(attempt =>
      attempt.error.status === 429 || attempt.error.code === 'rate_limit_exceeded'
    );
    const models = attempts.map(attempt => attempt.model).join(', ');
    const message = rateLimited
      ? `All free Groq ${label} models are currently rate-limited. Completed cards have been saved; try the remaining pages after the daily limits reset.`
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
  };
  const nested = candidate?.error ?? candidate?.response?.data?.error;

  return {
    status: candidate?.status ?? candidate?.statusCode ?? candidate?.response?.status,
    code: candidate?.code ?? nested?.code,
    message: nested?.message ?? candidate?.message ?? String(error),
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
  onFallback?: (fromModel: string, toModel: string, error: ModelErrorInfo) => void
): Promise<T> {
  if (models.length === 0) {
    throw new Error(`No Groq ${label} models are configured.`);
  }

  const attempts: ModelAttempt[] = [];
  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    try {
      return await operation(model);
    } catch (error) {
      if (!canTryAnotherModel(error)) throw error;

      const info = getModelErrorInfo(error);
      attempts.push({ model, error: info });
      const nextModel = models[index + 1];
      if (nextModel) onFallback?.(model, nextModel, info);
    }
  }

  throw new ModelPoolExhaustedError(label, attempts);
}
