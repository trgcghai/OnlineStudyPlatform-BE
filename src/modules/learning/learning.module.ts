import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LessonSummary } from '../ai-summary/entities/lesson-summary.entity';
import { CertificatesModule } from '../certificates/certificates.module';
import { Course } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { Quiz } from '../quizzes/entities/quiz.entity';
import { LearningAnalyticsEvent } from './entities/learning-analytics-event.entity';
import { LessonProgress } from './entities/lesson-progress.entity';
import { LessonWatchEvent } from './entities/lesson-watch-event.entity';
import { CourseProgressService } from './course-progress.service';
import { LearningAccessService } from './learning-access.service';
import { LearningController } from './learning.controller';
import { LearningProgressService } from './learning-progress.service';
import { LearningService } from './learning.service';
import { LessonCompletionService } from './lesson-completion.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Course,
      Lesson,
      LessonSummary,
      Enrollment,
      Quiz,
      QuizAttempt,
      LessonProgress,
      LessonWatchEvent,
      LearningAnalyticsEvent,
    ]),
    CertificatesModule,
  ],
  controllers: [LearningController],
  providers: [
    LearningAccessService,
    CourseProgressService,
    LearningService,
    LearningProgressService,
    LessonCompletionService,
  ],
  exports: [
    LearningAccessService,
    LearningProgressService,
    CourseProgressService,
  ],
})
export class LearningModule {}
