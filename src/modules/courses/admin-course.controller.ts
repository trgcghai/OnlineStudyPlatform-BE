import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { CoursesService } from './courses.service';

@Controller('admin/courses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminCourseController {
  constructor(private readonly coursesService: CoursesService) {}

  @Get(':courseId/lessons')
  listLessonsWithQuizzes(@Param('courseId', ParseUUIDPipe) courseId: string) {
    return this.coursesService.listLessonsWithQuizzes(courseId);
  }
}
