import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lesson } from '../lessons/entities/lesson.entity';
import { AI_SUMMARY_QUEUE } from './ai-summary.constants';
import { AiSummaryProcessor } from './ai-summary-processor';
import { AiSummaryService } from './ai-summary.service';
import { LessonAudioService } from './lesson-audio.service';
import { LessonSummary } from './entities/lesson-summary.entity';
import { AiKnowledgeModule } from '../ai-knowledge/ai-knowledge.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Lesson, LessonSummary]),
    BullModule.registerQueue({ name: AI_SUMMARY_QUEUE }),
    AiKnowledgeModule,
  ],
  providers: [AiSummaryService, AiSummaryProcessor, LessonAudioService],
  exports: [AiSummaryService, LessonAudioService],
})
export class AiSummaryModule {}
