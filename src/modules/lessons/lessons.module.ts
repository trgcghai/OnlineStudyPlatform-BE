import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/entities/course.entity';
import { LearningModule } from '../learning/learning.module';
import {
  LessonDetailController,
  LessonsController,
} from './lessons.controller';
import { Lesson } from './entities/lesson.entity';
import { LessonImport } from './entities/lesson-import.entity';
import { LessonImportService } from './import/lesson-import.service';
import { LessonImportCleanupService } from './import/lesson-import-cleanup.service';
import { LessonImportProcessorService } from './import/lesson-import-processor.service';
import { LessonImportQueueConsumer } from './import/queue/lesson-import-queue.consumer';
import { LessonImportQueuePublisher } from './import/queue/lesson-import-queue.publisher';
import { LESSON_IMPORT_QUEUE } from './import/queue/lesson-import-queue.constants';
import { LessonsService } from './lessons.service';
import { AiSummaryModule } from '../ai-summary/ai-summary.module';
import { LessonSummary } from '../ai-summary/entities/lesson-summary.entity';
import { AiKnowledgeModule } from '../ai-knowledge/ai-knowledge.module';
import { LessonVideoMetadataService } from './lesson-video-metadata.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: LESSON_IMPORT_QUEUE }),
    TypeOrmModule.forFeature([Lesson, LessonImport, Course, LessonSummary]),
    LearningModule,
    AiSummaryModule,
    AiKnowledgeModule,
  ],
  controllers: [LessonsController, LessonDetailController],
  providers: [
    LessonsService,
    LessonImportService,
    LessonImportCleanupService,
    LessonImportProcessorService,
    LessonImportQueueConsumer,
    LessonImportQueuePublisher,
    LessonVideoMetadataService,
  ],
  exports: [LessonsService],
})
export class LessonsModule {}
