export const LESSON_IMPORT_QUEUE = 'lesson-imports';
export const LESSON_IMPORT_JOB = 'process-lesson-import';
export const LESSON_IMPORT_MAX_RETRIES = 3;
export const LESSON_IMPORT_RETRY_DELAY_MS = 30_000;
export const LESSON_IMPORT_QUEUE_OPTIONS = {
  attempts: LESSON_IMPORT_MAX_RETRIES + 1,
  backoff: {
    type: 'exponential' as const,
    delay: LESSON_IMPORT_RETRY_DELAY_MS,
  },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
};

export interface LessonImportMessage {
  importId: string;
}
