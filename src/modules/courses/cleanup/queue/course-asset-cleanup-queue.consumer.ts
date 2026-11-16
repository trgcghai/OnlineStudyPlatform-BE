import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  COURSE_ASSET_CLEANUP_QUEUE,
  CourseAssetCleanupMessage,
} from './course-asset-cleanup-queue.constants';
import { CourseAssetCleanupService } from '../course-asset-cleanup.service';

@Processor(COURSE_ASSET_CLEANUP_QUEUE, { concurrency: 1 })
export class CourseAssetCleanupQueueConsumer extends WorkerHost {
  private readonly logger = new Logger(CourseAssetCleanupQueueConsumer.name);

  constructor(private readonly cleanupService: CourseAssetCleanupService) {
    super();
  }

  async process(job: Job<CourseAssetCleanupMessage>): Promise<void> {
    const message = this.parseMessage(job.data);

    try {
      await this.cleanupService.cleanup(message);
    } catch (error) {
      this.logger.error(
        `Course asset cleanup ${message.courseId} failed on job ${job.id} (attempt ${job.attemptsMade + 1})`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  private parseMessage(
    message: CourseAssetCleanupMessage,
  ): CourseAssetCleanupMessage {
    if (
      !message ||
      typeof message.courseId !== 'string' ||
      !message.courseId ||
      !Array.isArray(message.objectKeys) ||
      message.objectKeys.some(
        (key) => typeof key !== 'string' || key.length === 0,
      )
    ) {
      throw new TypeError('Invalid course asset cleanup message');
    }

    return message;
  }
}
