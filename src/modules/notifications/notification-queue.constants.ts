export const NOTIFICATION_QUEUE = 'notifications';
export const NOTIFICATION_CREATE_JOB = 'create-notification';
export const NOTIFICATION_CREATED_EVENT = 'notification.created';
export const NOTIFICATION_MAX_RETRIES = 3;
export const NOTIFICATION_RETRY_DELAY_MS = 10_000;
export const NOTIFICATION_QUEUE_OPTIONS = {
  attempts: NOTIFICATION_MAX_RETRIES + 1,
  backoff: {
    type: 'exponential' as const,
    delay: NOTIFICATION_RETRY_DELAY_MS,
  },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
};
