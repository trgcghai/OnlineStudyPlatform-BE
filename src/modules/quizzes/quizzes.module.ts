import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/entities/course.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
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
    TypeOrmModule.forFeature([Quiz, Question, QuizAttempt, Lesson, Course]),
  ],
  controllers: [
    QuizzesController,
    QuizQuestionsController,
    QuizManageController,
    QuestionManageController,
  ],
  providers: [QuizzesService, QuizAttemptCleanupService],
  exports: [QuizzesService],
})
export class QuizzesModule {}
