import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { LearningAnalyticsEvent } from '../learning/entities/learning-analytics-event.entity';
import { LessonProgress } from '../learning/entities/lesson-progress.entity';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { RecommendationsAiGateway } from './recommendations-ai.gateway';
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
  ],
  controllers: [RecommendationsController],
  providers: [RecommendationsService, RecommendationsAiGateway],
})
export class RecommendationsModule {}
