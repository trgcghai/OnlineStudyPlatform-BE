import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  NOTIFICATION_CREATE_JOB,
  NOTIFICATION_QUEUE,
  NOTIFICATION_QUEUE_OPTIONS,
} from './notification-queue.constants';
import { NotificationCreateMessage } from './dto/notification.dto';

@Injectable()
export class NotificationsQueueService {
  private readonly logger = new Logger(NotificationsQueueService.name);

  constructor(
    @InjectQueue(NOTIFICATION_QUEUE)
    private readonly queue: Queue<NotificationCreateMessage>,
  ) {}

  enqueueCreateNotification(message: NotificationCreateMessage): void {
    void this.queue
      .add(NOTIFICATION_CREATE_JOB, message, NOTIFICATION_QUEUE_OPTIONS)
      .catch((error: unknown) => {
        this.logger.error(
          'Could not enqueue notification creation job',
          error instanceof Error ? error.stack : String(error),
        );
      });
  }
}
