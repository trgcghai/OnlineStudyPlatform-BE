export const AI_SUMMARY_QUEUE = 'ai-summary';
export const AI_SUMMARY_JOB = 'generate-lesson-summary';
export const DEFAULT_AI_SUMMARY_ATTEMPTS = 3;
export const DEFAULT_AI_SUMMARY_BACKOFF_MS = 5_000;
export const DEFAULT_AI_SUMMARY_CONCURRENCY = 1;
const configuredConcurrency = Number(
  process.env.AI_SUMMARY_QUEUE_CONCURRENCY ?? DEFAULT_AI_SUMMARY_CONCURRENCY,
);
export const AI_SUMMARY_CONCURRENCY =
  Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
    ? configuredConcurrency
    : DEFAULT_AI_SUMMARY_CONCURRENCY;
export const DEFAULT_AI_TRANSCRIBE_TIMEOUT_MS = 30 * 60 * 1_000;
export const DEFAULT_AI_SUMMARIZE_TIMEOUT_MS = 60_000;
