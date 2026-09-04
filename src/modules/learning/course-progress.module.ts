import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { Quiz } from '../quizzes/entities/quiz.entity';
import { CourseProgressService } from './course-progress.service';
import { LessonProgress } from './entities/lesson-progress.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Enrollment,
      Lesson,
      LessonProgress,
      Quiz,
      QuizAttempt,
    ]),
  ],
  providers: [CourseProgressService],
  exports: [CourseProgressService],
})
export class CourseProgressModule {}
