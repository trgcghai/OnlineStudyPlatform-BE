import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/entities/course.entity';
import {
  LessonDetailController,
  LessonsController,
} from './lessons.controller';
import { Lesson } from './entities/lesson.entity';
import { LessonsService } from './lessons.service';

@Module({
  imports: [TypeOrmModule.forFeature([Lesson, Course])],
  controllers: [LessonsController, LessonDetailController],
  providers: [LessonsService],
  exports: [LessonsService],
})
export class LessonsModule {}
