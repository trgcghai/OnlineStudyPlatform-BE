import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import {
  COURSE_ASSET_CLEANUP_DLQ,
  COURSE_ASSET_CLEANUP_DLQ_ROUTING_KEY,
  COURSE_ASSET_CLEANUP_EXCHANGE,
  COURSE_ASSET_CLEANUP_QUEUE,
  COURSE_ASSET_CLEANUP_RETRY_DELAY_MS,
  COURSE_ASSET_CLEANUP_RETRY_QUEUE,
  COURSE_ASSET_CLEANUP_RETRY_ROUTING_KEY,
  COURSE_ASSET_CLEANUP_ROUTING_KEY,
  CourseAssetCleanupMessage,
} from './course-asset-cleanup-queue.constants';

@Injectable()
export class CourseAssetCleanupQueuePublisher
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CourseAssetCleanupQueuePublisher.name);
  private connection?: amqp.ChannelModel;
  private channel?: amqp.ConfirmChannel;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.connection = await amqp.connect(
      this.configService.getOrThrow<string>('RABBITMQ_URL'),
    );
    this.channel = await this.connection.createConfirmChannel();
    await this.assertTopology(this.channel);
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  async enqueue(message: CourseAssetCleanupMessage): Promise<void> {
    if (!this.channel) {
      throw new ServiceUnavailableException(
        'Course asset cleanup queue is unavailable',
      );
    }

    this.channel.publish(
      COURSE_ASSET_CLEANUP_EXCHANGE,
      COURSE_ASSET_CLEANUP_ROUTING_KEY,
      Buffer.from(JSON.stringify(message)),
      { persistent: true, contentType: 'application/json' },
    );

    try {
      await this.channel.waitForConfirms();
    } catch (error) {
      this.logger.error(
        'RabbitMQ did not confirm course asset cleanup message',
      );
      throw new ServiceUnavailableException(
        'Course asset cleanup queue is unavailable',
        { cause: error },
      );
    }
  }

  static async assertTopology(channel: amqp.Channel): Promise<void> {
    await channel.assertExchange(COURSE_ASSET_CLEANUP_EXCHANGE, 'direct', {
      durable: true,
    });
    await channel.assertQueue(COURSE_ASSET_CLEANUP_QUEUE, { durable: true });
    await channel.assertQueue(COURSE_ASSET_CLEANUP_RETRY_QUEUE, {
      durable: true,
      messageTtl: COURSE_ASSET_CLEANUP_RETRY_DELAY_MS,
      deadLetterExchange: COURSE_ASSET_CLEANUP_EXCHANGE,
      deadLetterRoutingKey: COURSE_ASSET_CLEANUP_ROUTING_KEY,
    });
    await channel.assertQueue(COURSE_ASSET_CLEANUP_DLQ, { durable: true });
    await channel.bindQueue(
      COURSE_ASSET_CLEANUP_QUEUE,
      COURSE_ASSET_CLEANUP_EXCHANGE,
      COURSE_ASSET_CLEANUP_ROUTING_KEY,
    );
    await channel.bindQueue(
      COURSE_ASSET_CLEANUP_RETRY_QUEUE,
      COURSE_ASSET_CLEANUP_EXCHANGE,
      COURSE_ASSET_CLEANUP_RETRY_ROUTING_KEY,
    );
    await channel.bindQueue(
      COURSE_ASSET_CLEANUP_DLQ,
      COURSE_ASSET_CLEANUP_EXCHANGE,
      COURSE_ASSET_CLEANUP_DLQ_ROUTING_KEY,
    );
  }

  private assertTopology(channel: amqp.Channel): Promise<void> {
    return CourseAssetCleanupQueuePublisher.assertTopology(channel);
  }
}
