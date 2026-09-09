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
import { AdminCourseContentService } from './admin-course-content.service';

@Controller('admin/courses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminCourseContentController {
  constructor(
    private readonly adminCourseContentService: AdminCourseContentService,
  ) {}

  @Get(':courseId/lessons')
  listLessonsWithQuizzes(@Param('courseId', ParseUUIDPipe) courseId: string) {
    return this.adminCourseContentService.listLessonsWithQuizzes(courseId);
  }
}
