import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { LearningAnalyticsEvent } from '../learning/entities/learning-analytics-event.entity';
import { LessonProgress } from '../learning/entities/lesson-progress.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { DashboardController } from './dashboard.controller';
import { LearnerDashboardService } from './learner-dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Enrollment,
      Lesson,
      LessonProgress,
      QuizAttempt,
      LearningAnalyticsEvent,
    ]),
  ],
  controllers: [DashboardController],
  providers: [LearnerDashboardService],
})
export class DashboardModule {}
