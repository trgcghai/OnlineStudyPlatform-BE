import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  COURSE_ASSET_CLEANUP_JOB,
  COURSE_ASSET_CLEANUP_QUEUE,
  COURSE_ASSET_CLEANUP_QUEUE_OPTIONS,
  CourseAssetCleanupMessage,
} from './course-asset-cleanup-queue.constants';

@Injectable()
export class CourseAssetCleanupQueuePublisher {
  constructor(
    @InjectQueue(COURSE_ASSET_CLEANUP_QUEUE)
    private readonly queue: Queue<CourseAssetCleanupMessage>,
  ) {}

  async enqueue(message: CourseAssetCleanupMessage): Promise<void> {
    try {
      await this.queue.add(
        COURSE_ASSET_CLEANUP_JOB,
        message,
        COURSE_ASSET_CLEANUP_QUEUE_OPTIONS,
      );
    } catch (error) {
      throw new ServiceUnavailableException(
        'Course asset cleanup queue is unavailable',
        { cause: error },
      );
    }
  }
}
