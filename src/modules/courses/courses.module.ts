import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { Question } from '../quizzes/entities/question.entity';
import { Quiz } from '../quizzes/entities/quiz.entity';
import { AdminCourseController } from './admin-course.controller';
import { CoursesController } from './courses.controller';
import { PublicCoursesController } from './public-courses.controller';
import { Course } from './entities/course.entity';
import { CoursesService } from './courses.service';
import { CourseAssetCleanupQueuePublisher } from './cleanup/queue/course-asset-cleanup-queue.publisher';
import { CourseAssetCleanupQueueConsumer } from './cleanup/queue/course-asset-cleanup-queue.consumer';
import { CourseAssetCleanupService } from './cleanup/course-asset-cleanup.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Course, Enrollment, Lesson, Quiz, Question]),
    NotificationsModule,
    PaymentsModule,
  ],
  controllers: [
    PublicCoursesController,
    CoursesController,
    AdminCourseController,
  ],
  providers: [
    CoursesService,
    CourseAssetCleanupService,
    CourseAssetCleanupQueueConsumer,
    CourseAssetCleanupQueuePublisher,
  ],
  exports: [CoursesService],
})
export class CoursesModule {}
