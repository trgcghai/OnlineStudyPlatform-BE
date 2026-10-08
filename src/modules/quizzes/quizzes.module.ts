import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/entities/course.entity';
import { LearningModule } from '../learning/learning.module';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { LearningAnalyticsEvent } from '../learning/entities/learning-analytics-event.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/entities/user.entity';
import {
  EssayAnswerGradingController,
  EssayGradingController,
} from './essay-grading.controller';
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
import { LearnerQuizzesController } from './learner-quizzes.controller';
import { QuizAttemptsService } from './quiz-attempts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Quiz,
      Question,
      QuizAttempt,
      Lesson,
      Course,
      Enrollment,
      LearningAnalyticsEvent,
      User,
    ]),
    LearningModule,
    NotificationsModule,
  ],
  controllers: [
    LearnerQuizzesController,
    QuizzesController,
    QuizQuestionsController,
    QuizManageController,
    QuestionManageController,
    EssayGradingController,
    EssayAnswerGradingController,
  ],
  providers: [
    QuizzesService,
    QuizAttemptCleanupService,
    EssayGradingService,
    QuizAttemptsService,
  ],
  exports: [QuizzesService],
})
export class QuizzesModule {}
