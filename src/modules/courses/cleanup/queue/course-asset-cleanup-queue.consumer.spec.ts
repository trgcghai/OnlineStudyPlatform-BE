import { CourseAssetCleanupService } from '../course-asset-cleanup.service';
import { CourseAssetCleanupQueueConsumer } from './course-asset-cleanup-queue.consumer';

describe('CourseAssetCleanupQueueConsumer', () => {
  const courseId = '33333333-3333-4333-8333-333333333333';
  let cleanupService: { cleanup: jest.Mock };
  let consumer: CourseAssetCleanupQueueConsumer;

  beforeEach(() => {
    cleanupService = { cleanup: jest.fn().mockResolvedValue(undefined) };
    consumer = new CourseAssetCleanupQueueConsumer(
      cleanupService as unknown as CourseAssetCleanupService,
    );
  });

  it('processes a valid cleanup job', async () => {
    const message = {
      courseId,
      objectKeys: ['courses/course/video.mp4'],
    };

    await consumer.process({
      id: 'job-1',
      attemptsMade: 0,
      data: message,
    } as never);

    expect(cleanupService.cleanup).toHaveBeenCalledWith(message);
  });

  it('rethrows cleanup failures for BullMQ retry', async () => {
    const error = new Error('minio down');
    cleanupService.cleanup.mockRejectedValueOnce(error);

    await expect(
      consumer.process({
        id: 'job-1',
        attemptsMade: 0,
        data: { courseId, objectKeys: ['courses/course/video.mp4'] },
      } as never),
    ).rejects.toBe(error);
  });

  it('rejects malformed cleanup jobs', async () => {
    await expect(
      consumer.process({
        id: 'job-1',
        attemptsMade: 0,
        data: { courseId, objectKeys: [null] },
      } as never),
    ).rejects.toThrow('Invalid course asset cleanup message');
    expect(cleanupService.cleanup).not.toHaveBeenCalled();
  });
});
