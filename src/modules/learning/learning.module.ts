import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { LessonsModule } from '../lessons/lessons.module';
import { LearningAnalyticsEvent } from './entities/learning-analytics-event.entity';
import { LessonProgress } from './entities/lesson-progress.entity';
import { LessonWatchEvent } from './entities/lesson-watch-event.entity';
import { LearningController } from './learning.controller';
import { LearningProgressService } from './learning-progress.service';
import { LearningService } from './learning.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Course,
      Lesson,
      Enrollment,
      LessonProgress,
      LessonWatchEvent,
      LearningAnalyticsEvent,
    ]),
    LessonsModule,
  ],
  controllers: [LearningController],
  providers: [LearningService, LearningProgressService],
})
export class LearningModule {}
