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
  LESSON_IMPORT_DLQ,
  LESSON_IMPORT_DLQ_ROUTING_KEY,
  LESSON_IMPORT_EXCHANGE,
  LESSON_IMPORT_QUEUE,
  LESSON_IMPORT_RETRY_DELAY_MS,
  LESSON_IMPORT_RETRY_QUEUE,
  LESSON_IMPORT_RETRY_ROUTING_KEY,
  LESSON_IMPORT_ROUTING_KEY,
  LessonImportMessage,
} from './lesson-import-queue.constants';

@Injectable()
export class LessonImportQueuePublisher
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(LessonImportQueuePublisher.name);
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

  async enqueue(message: LessonImportMessage): Promise<void> {
    if (!this.channel) {
      throw new ServiceUnavailableException('Import queue is unavailable');
    }

    this.channel.publish(
      LESSON_IMPORT_EXCHANGE,
      LESSON_IMPORT_ROUTING_KEY,
      Buffer.from(JSON.stringify(message)),
      { persistent: true, contentType: 'application/json' },
    );
    try {
      await this.channel.waitForConfirms();
    } catch (error) {
      this.logger.error('RabbitMQ did not confirm lesson import message');
      throw new ServiceUnavailableException('Import queue is unavailable', {
        cause: error,
      });
    }
  }

  static async assertTopology(channel: amqp.Channel): Promise<void> {
    await channel.assertExchange(LESSON_IMPORT_EXCHANGE, 'direct', {
      durable: true,
    });
    await channel.assertQueue(LESSON_IMPORT_QUEUE, { durable: true });
    await channel.assertQueue(LESSON_IMPORT_RETRY_QUEUE, {
      durable: true,
      messageTtl: LESSON_IMPORT_RETRY_DELAY_MS,
      deadLetterExchange: LESSON_IMPORT_EXCHANGE,
      deadLetterRoutingKey: LESSON_IMPORT_ROUTING_KEY,
    });
    await channel.assertQueue(LESSON_IMPORT_DLQ, { durable: true });
    await channel.bindQueue(
      LESSON_IMPORT_QUEUE,
      LESSON_IMPORT_EXCHANGE,
      LESSON_IMPORT_ROUTING_KEY,
    );
    await channel.bindQueue(
      LESSON_IMPORT_RETRY_QUEUE,
      LESSON_IMPORT_EXCHANGE,
      LESSON_IMPORT_RETRY_ROUTING_KEY,
    );
    await channel.bindQueue(
      LESSON_IMPORT_DLQ,
      LESSON_IMPORT_EXCHANGE,
      LESSON_IMPORT_DLQ_ROUTING_KEY,
    );
  }

  private assertTopology(channel: amqp.Channel): Promise<void> {
    return LessonImportQueuePublisher.assertTopology(channel);
  }
}
