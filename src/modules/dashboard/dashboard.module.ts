import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { LearningAnalyticsEvent } from '../learning/entities/learning-analytics-event.entity';
import { LessonProgress } from '../learning/entities/lesson-progress.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { User } from '../users/entities/user.entity';
import { RiskScore, RiskScoreSchema } from '../risk/schemas/risk-score.schema';
import { DashboardController } from './dashboard.controller';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { LearnerDashboardService } from './learner-dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Enrollment,
      User,
      Course,
      Lesson,
      LessonProgress,
      QuizAttempt,
      LearningAnalyticsEvent,
    ]),
    MongooseModule.forFeature([
      { name: RiskScore.name, schema: RiskScoreSchema },
    ]),
  ],
  controllers: [DashboardController, AdminDashboardController],
  providers: [LearnerDashboardService, AdminDashboardService],
})
export class DashboardModule {}
