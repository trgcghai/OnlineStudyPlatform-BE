import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  LESSON_IMPORT_JOB,
  LESSON_IMPORT_QUEUE,
  LESSON_IMPORT_QUEUE_OPTIONS,
  LessonImportMessage,
} from './lesson-import-queue.constants';

@Injectable()
export class LessonImportQueuePublisher {
  constructor(
    @InjectQueue(LESSON_IMPORT_QUEUE)
    private readonly queue: Queue<LessonImportMessage>,
  ) {}

  async enqueue(message: LessonImportMessage): Promise<void> {
    try {
      await this.queue.add(
        LESSON_IMPORT_JOB,
        message,
        LESSON_IMPORT_QUEUE_OPTIONS,
      );
    } catch (error) {
      throw new ServiceUnavailableException('Import queue is unavailable', {
        cause: error,
      });
    }
  }
}
