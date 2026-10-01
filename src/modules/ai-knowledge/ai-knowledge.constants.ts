export const AI_KNOWLEDGE_QUEUE = 'ai-knowledge-index';
export const AI_KNOWLEDGE_INDEX_JOB = 'index-lesson-knowledge';
export const AI_KNOWLEDGE_DELETE_SOURCE_JOB = 'delete-lesson-knowledge-source';
export const AI_KNOWLEDGE_DELETE_COURSE_JOB = 'delete-course-knowledge';
export const DEFAULT_AI_KNOWLEDGE_ATTEMPTS = 3;
export const DEFAULT_AI_KNOWLEDGE_BACKOFF_MS = 5_000;
export const DEFAULT_AI_KNOWLEDGE_TIMEOUT_MS = 10 * 60 * 1_000;
export const DEFAULT_AI_KNOWLEDGE_CONCURRENCY = 1;

const configuredConcurrency = Number(
  process.env.AI_KNOWLEDGE_QUEUE_CONCURRENCY ??
    DEFAULT_AI_KNOWLEDGE_CONCURRENCY,
);

export const AI_KNOWLEDGE_CONCURRENCY =
  Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
    ? configuredConcurrency
    : DEFAULT_AI_KNOWLEDGE_CONCURRENCY;
