import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LessonSummary } from '../ai-summary/entities/lesson-summary.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { AI_KNOWLEDGE_QUEUE } from './ai-knowledge.constants';
import { AiKnowledgeGatewayService } from './ai-knowledge-gateway.service';
import { AiKnowledgeProcessor } from './ai-knowledge-processor';
import { AiKnowledgeService } from './ai-knowledge.service';
import { LessonKnowledgeSource } from './entities/lesson-knowledge-source.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lesson, LessonSummary, LessonKnowledgeSource]),
    BullModule.registerQueue({ name: AI_KNOWLEDGE_QUEUE }),
  ],
  providers: [
    AiKnowledgeService,
    AiKnowledgeGatewayService,
    AiKnowledgeProcessor,
  ],
  exports: [AiKnowledgeService],
})
export class AiKnowledgeModule {}
