import {
  COURSE_ASSET_CLEANUP_JOB,
  COURSE_ASSET_CLEANUP_QUEUE_OPTIONS,
} from './course-asset-cleanup-queue.constants';
import { CourseAssetCleanupQueuePublisher } from './course-asset-cleanup-queue.publisher';

describe('CourseAssetCleanupQueuePublisher', () => {
  it('enqueues cleanup jobs with BullMQ options', async () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const publisher = new CourseAssetCleanupQueuePublisher(queue as never);
    const message = {
      courseId: 'course-1',
      objectKeys: ['courses/course-1/video.mp4'],
    };

    await publisher.enqueue(message);

    expect(queue.add).toHaveBeenCalledWith(
      COURSE_ASSET_CLEANUP_JOB,
      message,
      COURSE_ASSET_CLEANUP_QUEUE_OPTIONS,
    );
  });

  it('converts queue errors to service-unavailable errors', async () => {
    const queue = { add: jest.fn().mockRejectedValue(new Error('redis down')) };
    const publisher = new CourseAssetCleanupQueuePublisher(queue as never);

    await expect(
      publisher.enqueue({
        courseId: 'course-1',
        objectKeys: ['courses/course-1/video.mp4'],
      }),
    ).rejects.toThrow('Course asset cleanup queue is unavailable');
  });
});
