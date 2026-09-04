import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { LessonsModule } from '../lessons/lessons.module';
import { LearnerQuizzesController } from '../quizzes/learner-quizzes.controller';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { Quiz } from '../quizzes/entities/quiz.entity';
import { QuizAttemptsService } from '../quizzes/quiz-attempts.service';
import { LearningAnalyticsEvent } from './entities/learning-analytics-event.entity';
import { LessonProgress } from './entities/lesson-progress.entity';
import { LessonWatchEvent } from './entities/lesson-watch-event.entity';
import { CourseProgressModule } from './course-progress.module';
import { LearningController } from './learning.controller';
import { LearningProgressService } from './learning-progress.service';
import { LearningService } from './learning.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Course,
      Lesson,
      Enrollment,
      Quiz,
      QuizAttempt,
      LessonProgress,
      LessonWatchEvent,
      LearningAnalyticsEvent,
    ]),
    LessonsModule,
    CourseProgressModule,
  ],
  controllers: [LearningController, LearnerQuizzesController],
  providers: [LearningService, LearningProgressService, QuizAttemptsService],
})
export class LearningModule {}
