import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { CourseAssetCleanupService } from '../course-asset-cleanup.service';
import {
  COURSE_ASSET_CLEANUP_DLQ_ROUTING_KEY,
  COURSE_ASSET_CLEANUP_EXCHANGE,
  COURSE_ASSET_CLEANUP_MAX_RETRIES,
  COURSE_ASSET_CLEANUP_RETRY_HEADER,
  COURSE_ASSET_CLEANUP_RETRY_ROUTING_KEY,
} from './course-asset-cleanup-queue.constants';
import { CourseAssetCleanupQueueConsumer } from './course-asset-cleanup-queue.consumer';

describe('CourseAssetCleanupQueueConsumer', () => {
  const courseId = '33333333-3333-4333-8333-333333333333';
  let cleanupService: { cleanup: jest.Mock };
  let channel: { publish: jest.Mock; ack: jest.Mock };
  let consumer: CourseAssetCleanupQueueConsumer;

  const makeMessage = (
    body: unknown,
    headers: Record<string, unknown> = {},
  ): amqp.ConsumeMessage =>
    ({
      content: Buffer.from(JSON.stringify(body)),
      properties: { headers },
      fields: {},
    }) as amqp.ConsumeMessage;

  const handle = (message: amqp.ConsumeMessage): Promise<void> =>
    (
      consumer as unknown as {
        handle(message: amqp.ConsumeMessage): Promise<void>;
      }
    ).handle(message);

  beforeEach(() => {
    cleanupService = { cleanup: jest.fn().mockResolvedValue(undefined) };
    channel = { publish: jest.fn(), ack: jest.fn() };
    consumer = new CourseAssetCleanupQueueConsumer(
      {} as ConfigService,
      cleanupService as unknown as CourseAssetCleanupService,
    );
    Object.assign(consumer, { channel });
  });

  it('acknowledges a successfully cleaned course', async () => {
    const message = makeMessage({
      courseId,
      objectKeys: ['courses/course/video.mp4'],
    });

    await handle(message);

    expect(cleanupService.cleanup).toHaveBeenCalledWith({
      courseId,
      objectKeys: ['courses/course/video.mp4'],
    });
    expect(channel.publish).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('routes transient cleanup failures through the retry queue', async () => {
    cleanupService.cleanup.mockRejectedValue(new Error('minio down'));
    const message = makeMessage({
      courseId,
      objectKeys: ['courses/course/video.mp4'],
    });

    await handle(message);

    expect(channel.publish).toHaveBeenCalledWith(
      COURSE_ASSET_CLEANUP_EXCHANGE,
      COURSE_ASSET_CLEANUP_RETRY_ROUTING_KEY,
      message.content,
      expect.objectContaining({
        headers: { [COURSE_ASSET_CLEANUP_RETRY_HEADER]: 1 },
      }),
    );
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('moves exhausted cleanup jobs to the dead-letter queue', async () => {
    cleanupService.cleanup.mockRejectedValue(new Error('minio down'));
    const message = makeMessage(
      { courseId, objectKeys: ['courses/course/video.mp4'] },
      { [COURSE_ASSET_CLEANUP_RETRY_HEADER]: COURSE_ASSET_CLEANUP_MAX_RETRIES },
    );

    await handle(message);

    expect(channel.publish).toHaveBeenCalledWith(
      COURSE_ASSET_CLEANUP_EXCHANGE,
      COURSE_ASSET_CLEANUP_DLQ_ROUTING_KEY,
      message.content,
      expect.any(Object),
    );
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('moves malformed messages directly to the dead-letter queue', async () => {
    const message = makeMessage({ courseId, objectKeys: [null] });

    await handle(message);

    expect(cleanupService.cleanup).not.toHaveBeenCalled();
    expect(channel.publish).toHaveBeenCalledWith(
      COURSE_ASSET_CLEANUP_EXCHANGE,
      COURSE_ASSET_CLEANUP_DLQ_ROUTING_KEY,
      message.content,
      expect.any(Object),
    );
    expect(channel.ack).toHaveBeenCalledWith(message);
  });
});
