import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { CourseAssetCleanupService } from '../course-asset-cleanup.service';
import {
  COURSE_ASSET_CLEANUP_DLQ_ROUTING_KEY,
  COURSE_ASSET_CLEANUP_EXCHANGE,
  COURSE_ASSET_CLEANUP_MAX_RETRIES,
  COURSE_ASSET_CLEANUP_QUEUE,
  COURSE_ASSET_CLEANUP_RETRY_HEADER,
  COURSE_ASSET_CLEANUP_RETRY_ROUTING_KEY,
  CourseAssetCleanupMessage,
} from './course-asset-cleanup-queue.constants';
import { CourseAssetCleanupQueuePublisher } from './course-asset-cleanup-queue.publisher';

@Injectable()
export class CourseAssetCleanupQueueConsumer
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CourseAssetCleanupQueueConsumer.name);
  private connection?: amqp.ChannelModel;
  private channel?: amqp.Channel;

  constructor(
    private readonly configService: ConfigService,
    private readonly cleanupService: CourseAssetCleanupService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.connection = await amqp.connect(
      this.configService.getOrThrow<string>('RABBITMQ_URL'),
    );
    this.channel = await this.connection.createChannel();
    await CourseAssetCleanupQueuePublisher.assertTopology(this.channel);
    await this.channel.prefetch(1);
    await this.channel.consume(COURSE_ASSET_CLEANUP_QUEUE, (message) => {
      if (message) void this.handle(message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  private async handle(message: amqp.ConsumeMessage): Promise<void> {
    const channel = this.getChannel();
    let parsed: CourseAssetCleanupMessage;

    try {
      parsed = JSON.parse(
        message.content.toString('utf8'),
      ) as CourseAssetCleanupMessage;
      if (
        !parsed.courseId ||
        !Array.isArray(parsed.objectKeys) ||
        parsed.objectKeys.some((key) => typeof key !== 'string' || key === '')
      ) {
        throw new TypeError('Invalid course asset cleanup message');
      }
    } catch {
      this.publish(message, COURSE_ASSET_CLEANUP_DLQ_ROUTING_KEY);
      channel.ack(message);
      return;
    }

    try {
      await this.cleanupService.cleanup(parsed);
      channel.ack(message);
    } catch (error) {
      const retries = this.retryCount(message);
      this.logger.error(
        `Course asset cleanup ${parsed.courseId} failed (attempt ${retries + 1})`,
        error instanceof Error ? error.stack : String(error),
      );

      this.publish(
        message,
        retries >= COURSE_ASSET_CLEANUP_MAX_RETRIES
          ? COURSE_ASSET_CLEANUP_DLQ_ROUTING_KEY
          : COURSE_ASSET_CLEANUP_RETRY_ROUTING_KEY,
        retries >= COURSE_ASSET_CLEANUP_MAX_RETRIES ? undefined : retries + 1,
      );
      channel.ack(message);
    }
  }

  private publish(
    message: amqp.ConsumeMessage,
    routingKey: string,
    retryCount?: number,
  ): void {
    this.getChannel().publish(
      COURSE_ASSET_CLEANUP_EXCHANGE,
      routingKey,
      message.content,
      {
        persistent: true,
        contentType: 'application/json',
        headers: {
          ...message.properties.headers,
          ...(retryCount === undefined
            ? {}
            : { [COURSE_ASSET_CLEANUP_RETRY_HEADER]: retryCount }),
        },
      },
    );
  }

  private retryCount(message: amqp.ConsumeMessage): number {
    const value =
      message.properties.headers?.[COURSE_ASSET_CLEANUP_RETRY_HEADER];
    return typeof value === 'number' ? value : 0;
  }

  private getChannel(): amqp.Channel {
    if (!this.channel) {
      throw new Error('Course asset cleanup queue is not initialized');
    }
    return this.channel;
  }
}
