import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/entities/course.entity';
import { LessonProgress } from '../learning/entities/lesson-progress.entity';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';
import { Enrollment } from './entities/enrollment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Enrollment, Course, LessonProgress, QuizAttempt]),
  ],
  controllers: [EnrollmentsController],
  providers: [EnrollmentsService],
  exports: [EnrollmentsService],
})
export class EnrollmentsModule {}
