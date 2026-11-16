export const COURSE_ASSET_CLEANUP_QUEUE = 'course-asset-cleanup';
export const COURSE_ASSET_CLEANUP_JOB = 'cleanup-course-assets';
export const COURSE_ASSET_CLEANUP_MAX_RETRIES = 3;
export const COURSE_ASSET_CLEANUP_RETRY_DELAY_MS = 30_000;
export const COURSE_ASSET_CLEANUP_QUEUE_OPTIONS = {
  attempts: COURSE_ASSET_CLEANUP_MAX_RETRIES + 1,
  backoff: {
    type: 'exponential' as const,
    delay: COURSE_ASSET_CLEANUP_RETRY_DELAY_MS,
  },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
};

export interface CourseAssetCleanupMessage {
  courseId: string;
  objectKeys: string[];
}
