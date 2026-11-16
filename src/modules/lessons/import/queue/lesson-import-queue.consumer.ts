import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  LESSON_IMPORT_QUEUE,
  LessonImportMessage,
} from './lesson-import-queue.constants';
import { LessonImportProcessorService } from '../lesson-import-processor.service';

@Processor(LESSON_IMPORT_QUEUE, { concurrency: 1 })
export class LessonImportQueueConsumer extends WorkerHost {
  private readonly logger = new Logger(LessonImportQueueConsumer.name);

  constructor(private readonly processor: LessonImportProcessorService) {
    super();
  }

  async process(job: Job<LessonImportMessage>): Promise<void> {
    const importId = this.parseMessage(job.data);

    try {
      await this.processor.process(importId);
    } catch (error) {
      this.logger.error(
        `Lesson import ${importId} failed on job ${job.id} (attempt ${job.attemptsMade + 1})`,
        error instanceof Error ? error.stack : String(error),
      );

      if (this.isFinalAttempt(job)) {
        await this.processor.failPermanently(importId);
      }

      throw error;
    }
  }

  private parseMessage(message: LessonImportMessage): string {
    if (!message || typeof message.importId !== 'string' || !message.importId) {
      throw new TypeError('Invalid lesson import message');
    }

    return message.importId;
  }

  private isFinalAttempt(job: Job<LessonImportMessage>): boolean {
    return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
  }
}
