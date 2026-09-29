import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lesson } from '../lessons/entities/lesson.entity';
import { AI_SUMMARY_QUEUE } from './ai-summary.constants';
import { AiSummaryProcessor } from './ai-summary-processor';
import { AiSummaryService } from './ai-summary.service';
import { LessonAudioService } from './lesson-audio.service';
import { LessonSummary } from './entities/lesson-summary.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Lesson, LessonSummary]),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.getOrThrow<string>('REDIS_HOST'),
          port: Number(configService.getOrThrow<string | number>('REDIS_PORT')),
          maxRetriesPerRequest: null,
        },
      }),
    }),
    BullModule.registerQueue({ name: AI_SUMMARY_QUEUE }),
  ],
  providers: [AiSummaryService, AiSummaryProcessor, LessonAudioService],
  exports: [AiSummaryService, LessonAudioService],
})
export class AiSummaryModule {}
