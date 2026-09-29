import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Cached, InvalidateCache } from '../redis/redis.decorators';
import { UserRole } from '../users/entities/user.entity';
import { ListCourseEnrollmentsQueryDto } from './dto/enrollment.dto';
import { EnrollmentsService } from './enrollments.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Post('courses/:courseId/enrollments')
  @InvalidateCache([
    'enrollments:learner',
    'recommendations:learner',
    'courses:public:detail',
    'learning:course',
    'learning:lesson',
    'dashboard:learner',
  ])
  @Roles(UserRole.LEARNER)
  @HttpCode(HttpStatus.CREATED)
  enroll(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser('id') learnerId: string,
  ) {
    return this.enrollmentsService.enroll(learnerId, courseId);
  }

  @Get('enrollments/me')
  @Cached({ namespace: 'enrollments:learner', ttl: 60, scope: 'user' })
  @Roles(UserRole.LEARNER)
  findMine(@CurrentUser('id') learnerId: string) {
    return this.enrollmentsService.findMine(learnerId);
  }

  @Get('courses/:courseId/enrollments')
  @Roles(UserRole.INSTRUCTOR)
  findCourseEnrollmentsForInstructor(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser('id') instructorId: string,
    @Query() query: ListCourseEnrollmentsQueryDto,
  ) {
    return this.enrollmentsService.findCourseEnrollmentsForInstructor(
      instructorId,
      courseId,
      query,
    );
  }
}
