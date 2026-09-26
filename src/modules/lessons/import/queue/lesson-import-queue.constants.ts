export const LESSON_IMPORT_EXCHANGE = 'lesson-imports';
export const LESSON_IMPORT_QUEUE = 'lesson-imports.process';
export const LESSON_IMPORT_RETRY_QUEUE = 'lesson-imports.retry';
export const LESSON_IMPORT_DLQ = 'lesson-imports.dlq';
export const LESSON_IMPORT_ROUTING_KEY = 'lesson-import.process';
export const LESSON_IMPORT_RETRY_ROUTING_KEY = 'lesson-import.retry';
export const LESSON_IMPORT_DLQ_ROUTING_KEY = 'lesson-import.failed';
export const LESSON_IMPORT_RETRY_HEADER = 'x-lesson-import-retry-count';
export const LESSON_IMPORT_MAX_RETRIES = 3;
export const LESSON_IMPORT_RETRY_DELAY_MS = 30_000;

export interface LessonImportMessage {
  importId: string;
}
