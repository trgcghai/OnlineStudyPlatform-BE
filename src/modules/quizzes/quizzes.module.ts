import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/entities/course.entity';
import { CourseProgressModule } from '../learning/course-progress.module';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { LearningAnalyticsEvent } from '../learning/entities/learning-analytics-event.entity';
import { LessonProgress } from '../learning/entities/lesson-progress.entity';
import { LessonWatchEvent } from '../learning/entities/lesson-watch-event.entity';
import { LearningProgressService } from '../learning/learning-progress.service';
import { Lesson } from '../lessons/entities/lesson.entity';
import { LessonsModule } from '../lessons/lessons.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/entities/user.entity';
import { EssayGradingController } from './essay-grading.controller';
import { EssayGradingService } from './essay-grading.service';
import {
  QuestionManageController,
  QuizManageController,
  QuizQuestionsController,
  QuizzesController,
} from './quizzes.controller';
import { Question } from './entities/question.entity';
import { QuizAttemptCleanupService } from './quiz-attempt-cleanup.service';
import { QuizAttempt } from './entities/quiz-attempt.entity';
import { Quiz } from './entities/quiz.entity';
import { QuizzesService } from './quizzes.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Quiz,
      Question,
      QuizAttempt,
      Lesson,
      Course,
      Enrollment,
      LessonProgress,
      LessonWatchEvent,
      LearningAnalyticsEvent,
      User,
    ]),
    LessonsModule,
    CourseProgressModule,
    NotificationsModule,
  ],
  controllers: [
    QuizzesController,
    QuizQuestionsController,
    QuizManageController,
    QuestionManageController,
    EssayGradingController,
  ],
  providers: [
    QuizzesService,
    QuizAttemptCleanupService,
    EssayGradingService,
    LearningProgressService,
  ],
  exports: [QuizzesService],
})
export class QuizzesModule {}
