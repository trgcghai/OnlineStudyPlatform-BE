import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import {
  NOTIFICATION_CREATE_DLQ,
  NOTIFICATION_CREATE_QUEUE,
  NOTIFICATION_CREATE_RETRY_QUEUE,
  NOTIFICATION_CREATE_ROUTING_KEY,
  NOTIFICATION_EXCHANGE,
  NOTIFICATION_MAX_RETRIES,
  NOTIFICATION_RETRY_DELAY_MS,
  NOTIFICATION_RETRY_HEADER,
} from './notification-queue.constants';
import { NotificationCreateMessage } from './dto/notification.dto';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationsQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationsQueueService.name);
  private connection?: amqp.ChannelModel;
  private channel?: amqp.Channel;

  constructor(
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
    await this.consumeCreateQueue();
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  enqueueCreateNotification(message: NotificationCreateMessage): void {
    const channel = this.getChannel();
    const published = channel.publish(
      NOTIFICATION_EXCHANGE,
      NOTIFICATION_CREATE_ROUTING_KEY,
      Buffer.from(JSON.stringify(message)),
      { persistent: true, contentType: 'application/json' },
    );

    if (!published) {
      this.logger.warn('RabbitMQ notification publish buffer is full');
    }
  }

  async handleCreateMessage(rawMessage: amqp.ConsumeMessage): Promise<void> {
    const channel = this.getChannel();

    try {
      const message = this.parseCreateMessage(rawMessage.content);
      const result =
        await this.notificationsService.createFromQueueMessage(message);
      this.emitNotificationCreated(
        message,
        result.notificationId,
        result.created,
      );
      channel.ack(rawMessage);
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof TypeError) {
        this.publishToDlq(rawMessage);
        channel.ack(rawMessage);
        return;
      }

      this.retryOrDlq(rawMessage);
      channel.ack(rawMessage);
    }
  }

  private emitNotificationCreated(
    message: NotificationCreateMessage,
    notificationId: string | undefined,
    created: boolean,
  ): void {
    if (!created || !notificationId) {
      return;
    }

    try {
      if (message.kind === 'direct') {
        this.notificationsGateway.emitNotificationCreatedToUser(
          message.targetUserId ?? '',
          notificationId,
        );
        return;
      }

      this.notificationsGateway.emitNotificationCreatedForQueue(
        message.queue!,
        notificationId,
      );
    } catch (error) {
      this.logger.error(
        'Could not emit notification created event',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async connect(): Promise<void> {
    const url = this.configService.getOrThrow<string>('RABBITMQ_URL');
    this.connection = await amqp.connect(url);
    this.channel = await this.connection.createChannel();
    await this.assertTopology(this.channel);
  }

  private async assertTopology(channel: amqp.Channel): Promise<void> {
    await channel.assertExchange(NOTIFICATION_EXCHANGE, 'direct', {
      durable: true,
    });
    await channel.assertQueue(NOTIFICATION_CREATE_DLQ, { durable: true });
    await channel.assertQueue(NOTIFICATION_CREATE_RETRY_QUEUE, {
      durable: true,
      deadLetterExchange: NOTIFICATION_EXCHANGE,
      deadLetterRoutingKey: NOTIFICATION_CREATE_ROUTING_KEY,
      messageTtl: NOTIFICATION_RETRY_DELAY_MS,
    });
    await channel.assertQueue(NOTIFICATION_CREATE_QUEUE, { durable: true });
    await channel.bindQueue(
      NOTIFICATION_CREATE_QUEUE,
      NOTIFICATION_EXCHANGE,
      NOTIFICATION_CREATE_ROUTING_KEY,
    );
    await channel.bindQueue(
      NOTIFICATION_CREATE_RETRY_QUEUE,
      NOTIFICATION_EXCHANGE,
      NOTIFICATION_CREATE_RETRY_QUEUE,
    );
    await channel.bindQueue(
      NOTIFICATION_CREATE_DLQ,
      NOTIFICATION_EXCHANGE,
      NOTIFICATION_CREATE_DLQ,
    );
  }

  private async consumeCreateQueue(): Promise<void> {
    const channel = this.getChannel();
    await channel.prefetch(10);
    await channel.consume(NOTIFICATION_CREATE_QUEUE, (message) => {
      if (!message) {
        return;
      }

      void this.handleCreateMessage(message).catch((error: unknown) => {
        this.logger.error(
          'Could not handle notification create message',
          error instanceof Error ? error.stack : String(error),
        );
      });
    });
  }

  private parseCreateMessage(content: Buffer): NotificationCreateMessage {
    const parsed = JSON.parse(
      content.toString('utf8'),
    ) as NotificationCreateMessage;

    if (
      !parsed.triggerKey ||
      !parsed.triggerDate ||
      !parsed.title ||
      !parsed.message
    ) {
      throw new TypeError('Invalid notification message');
    }

    if (parsed.kind === 'direct' && !parsed.targetUserId) {
      throw new TypeError('Direct notification requires targetUserId');
    }

    if (parsed.kind === 'queue' && !parsed.queue) {
      throw new TypeError('Queue notification requires queue');
    }

    if (parsed.kind !== 'direct' && parsed.kind !== 'queue') {
      throw new TypeError('Invalid notification kind');
    }

    return parsed;
  }

  private retryOrDlq(rawMessage: amqp.ConsumeMessage): void {
    const retryCount = this.getRetryCount(rawMessage);

    if (retryCount >= NOTIFICATION_MAX_RETRIES) {
      this.publishToDlq(rawMessage);
      return;
    }

    this.getChannel().publish(
      NOTIFICATION_EXCHANGE,
      NOTIFICATION_CREATE_RETRY_QUEUE,
      rawMessage.content,
      {
        persistent: true,
        contentType: 'application/json',
        headers: {
          ...rawMessage.properties.headers,
          [NOTIFICATION_RETRY_HEADER]: retryCount + 1,
        },
      },
    );
  }

  private publishToDlq(rawMessage: amqp.ConsumeMessage): void {
    this.getChannel().publish(
      NOTIFICATION_EXCHANGE,
      NOTIFICATION_CREATE_DLQ,
      rawMessage.content,
      {
        persistent: true,
        contentType: rawMessage.properties.contentType ?? 'application/json',
        headers: rawMessage.properties.headers,
      },
    );
  }

  private getRetryCount(rawMessage: amqp.ConsumeMessage): number {
    const value = rawMessage.properties.headers?.[NOTIFICATION_RETRY_HEADER];
    return typeof value === 'number' ? value : 0;
  }

  private getChannel(): amqp.Channel {
    if (!this.channel) {
      throw new Error('Notification queue channel is not initialized');
    }

    return this.channel;
  }
}
