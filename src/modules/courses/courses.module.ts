import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { CoursesController } from './courses.controller';
import { Course } from './entities/course.entity';
import { CoursesService } from './courses.service';

@Module({
  imports: [TypeOrmModule.forFeature([Course]), NotificationsModule],
  controllers: [CoursesController],
  providers: [CoursesService],
  exports: [CoursesService],
})
export class CoursesModule {}
