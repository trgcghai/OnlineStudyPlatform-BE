import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/entities/course.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { Question } from '../quizzes/entities/question.entity';
import { Quiz } from '../quizzes/entities/quiz.entity';
import { AdminCourseContentController } from './admin-course-content.controller';
import { AdminCourseContentService } from './admin-course-content.service';

@Module({
  imports: [TypeOrmModule.forFeature([Course, Lesson, Quiz, Question])],
  controllers: [AdminCourseContentController],
  providers: [AdminCourseContentService],
})
export class AdminCourseContentModule {}
