import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/entities/course.entity';
import { CourseProgressModule } from '../learning/course-progress.module';
import {
  LessonDetailController,
  LessonsController,
} from './lessons.controller';
import { Lesson } from './entities/lesson.entity';
import { LearningAccessService } from './learning-access.service';
import { LessonsService } from './lessons.service';

@Module({
  imports: [TypeOrmModule.forFeature([Lesson, Course]), CourseProgressModule],
  controllers: [LessonsController, LessonDetailController],
  providers: [LessonsService, LearningAccessService],
  exports: [LessonsService, LearningAccessService],
})
export class LessonsModule {}
