import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import {
  LESSON_IMPORT_DLQ_ROUTING_KEY,
  LESSON_IMPORT_EXCHANGE,
  LESSON_IMPORT_MAX_RETRIES,
  LESSON_IMPORT_QUEUE,
  LESSON_IMPORT_RETRY_HEADER,
  LESSON_IMPORT_RETRY_ROUTING_KEY,
  LessonImportMessage,
} from './lesson-import-queue.constants';
import { LessonImportQueuePublisher } from './lesson-import-queue.publisher';
import { LessonImportProcessorService } from '../lesson-import-processor.service';

@Injectable()
export class LessonImportQueueConsumer
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(LessonImportQueueConsumer.name);
  private connection?: amqp.ChannelModel;
  private channel?: amqp.Channel;

  constructor(
    private readonly configService: ConfigService,
    private readonly processor: LessonImportProcessorService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.connection = await amqp.connect(
      this.configService.getOrThrow<string>('RABBITMQ_URL'),
    );
    this.channel = await this.connection.createChannel();
    await LessonImportQueuePublisher.assertTopology(this.channel);
    await this.channel.prefetch(1);
    await this.channel.consume(LESSON_IMPORT_QUEUE, (message) => {
      if (message) void this.handle(message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  private async handle(message: amqp.ConsumeMessage): Promise<void> {
    const channel = this.getChannel();
    let parsed: LessonImportMessage;
    try {
      parsed = JSON.parse(
        message.content.toString('utf8'),
      ) as LessonImportMessage;
      if (!parsed.importId) throw new TypeError('Missing importId');
    } catch {
      this.publish(message, LESSON_IMPORT_DLQ_ROUTING_KEY);
      channel.ack(message);
      return;
    }

    try {
      await this.processor.process(parsed.importId);
      channel.ack(message);
    } catch (error) {
      const retries = this.retryCount(message);
      this.logger.error(
        `Lesson import ${parsed.importId} failed (attempt ${retries + 1})`,
        error instanceof Error ? error.stack : String(error),
      );
      if (retries >= LESSON_IMPORT_MAX_RETRIES) {
        await this.processor.failPermanently(parsed.importId);
        this.publish(message, LESSON_IMPORT_DLQ_ROUTING_KEY);
      } else {
        this.publish(message, LESSON_IMPORT_RETRY_ROUTING_KEY, retries + 1);
      }
      channel.ack(message);
    }
  }

  private publish(
    message: amqp.ConsumeMessage,
    routingKey: string,
    retryCount?: number,
  ): void {
    this.getChannel().publish(
      LESSON_IMPORT_EXCHANGE,
      routingKey,
      message.content,
      {
        persistent: true,
        contentType: 'application/json',
        headers: {
          ...message.properties.headers,
          ...(retryCount === undefined
            ? {}
            : { [LESSON_IMPORT_RETRY_HEADER]: retryCount }),
        },
      },
    );
  }

  private retryCount(message: amqp.ConsumeMessage): number {
    const value = message.properties.headers?.[LESSON_IMPORT_RETRY_HEADER];
    return typeof value === 'number' ? value : 0;
  }

  private getChannel(): amqp.Channel {
    if (!this.channel)
      throw new Error('Lesson import queue is not initialized');
    return this.channel;
  }
}
