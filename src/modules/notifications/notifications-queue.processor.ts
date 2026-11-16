import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { NOTIFICATION_QUEUE } from './notification-queue.constants';
import { NotificationCreateMessage } from './dto/notification.dto';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';

@Processor(NOTIFICATION_QUEUE, { concurrency: 10 })
export class NotificationsQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsQueueProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {
    super();
  }

  async process(job: Job<NotificationCreateMessage>): Promise<void> {
    const message = this.parseCreateMessage(job.data);
    const result =
      await this.notificationsService.createFromQueueMessage(message);

    if (!result.created || !result.notificationId) {
      return;
    }

    try {
      if (message.kind === 'direct') {
        this.notificationsGateway.emitNotificationCreatedToUser(
          message.targetUserId ?? '',
          result.notificationId,
        );
        return;
      }

      this.notificationsGateway.emitNotificationCreatedForQueue(
        message.queue!,
        result.notificationId,
      );
    } catch (error) {
      this.logger.error(
        `Could not emit notification created event for job ${job.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private parseCreateMessage(
    message: NotificationCreateMessage,
  ): NotificationCreateMessage {
    if (
      !message ||
      !message.triggerKey ||
      !message.triggerDate ||
      !message.title ||
      !message.message
    ) {
      throw new TypeError('Invalid notification message');
    }

    if (message.kind === 'direct' && !message.targetUserId) {
      throw new TypeError('Direct notification requires targetUserId');
    }

    if (message.kind === 'queue' && !message.queue) {
      throw new TypeError('Queue notification requires queue');
    }

    if (message.kind !== 'direct' && message.kind !== 'queue') {
      throw new TypeError('Invalid notification kind');
    }

    return message;
  }
}
