import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { LearningAnalyticsEvent } from '../learning/entities/learning-analytics-event.entity';
import { LessonProgress } from '../learning/entities/lesson-progress.entity';
import { LessonWatchEvent } from '../learning/entities/lesson-watch-event.entity';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { RiskController } from './risk.controller';
import { RiskFeatureService } from './risk-feature.service';
import { RiskPersistenceService } from './risk-persistence.service';
import { RiskSchedulerService } from './risk-scheduler.service';
import { RiskScoringService } from './risk-scoring.service';
import { RiskService } from './risk.service';
import { RiskScore, RiskScoreSchema } from './schemas/risk-score.schema';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Course,
      Enrollment,
      LearningAnalyticsEvent,
      LessonProgress,
      LessonWatchEvent,
      QuizAttempt,
    ]),
    MongooseModule.forFeature([
      { name: RiskScore.name, schema: RiskScoreSchema },
    ]),
  ],
  controllers: [RiskController],
  providers: [
    RiskFeatureService,
    RiskScoringService,
    RiskPersistenceService,
    RiskService,
    RiskSchedulerService,
  ],
})
export class RiskModule {}
