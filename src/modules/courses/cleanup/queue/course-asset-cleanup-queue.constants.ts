export const COURSE_ASSET_CLEANUP_EXCHANGE = 'course-asset-cleanup';
export const COURSE_ASSET_CLEANUP_QUEUE = 'course-asset-cleanup.process';
export const COURSE_ASSET_CLEANUP_RETRY_QUEUE = 'course-asset-cleanup.retry';
export const COURSE_ASSET_CLEANUP_DLQ = 'course-asset-cleanup.dlq';
export const COURSE_ASSET_CLEANUP_ROUTING_KEY = 'course-asset-cleanup.process';
export const COURSE_ASSET_CLEANUP_RETRY_ROUTING_KEY =
  'course-asset-cleanup.retry';
export const COURSE_ASSET_CLEANUP_DLQ_ROUTING_KEY =
  'course-asset-cleanup.failed';
export const COURSE_ASSET_CLEANUP_RETRY_HEADER =
  'x-course-asset-cleanup-retry-count';
export const COURSE_ASSET_CLEANUP_MAX_RETRIES = 3;
export const COURSE_ASSET_CLEANUP_RETRY_DELAY_MS = 30_000;

export interface CourseAssetCleanupMessage {
  courseId: string;
  objectKeys: string[];
}
