import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiClientModule } from '../ai-client/ai-client.module';
import { Course } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { LearningAnalyticsEvent } from '../learning/entities/learning-analytics-event.entity';
import { LessonProgress } from '../learning/entities/lesson-progress.entity';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { AiRecommendationsClient } from './ai-recommendations.client';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Course,
      Enrollment,
      LearningAnalyticsEvent,
      LessonProgress,
      QuizAttempt,
    ]),
    AiClientModule,
  ],
  controllers: [RecommendationsController],
  providers: [RecommendationsService, AiRecommendationsClient],
})
export class RecommendationsModule {}
