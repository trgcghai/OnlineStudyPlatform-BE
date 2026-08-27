import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { EnrollmentsService } from './enrollments.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Post('courses/:courseId/enrollments')
  @Roles(UserRole.LEARNER)
  @HttpCode(HttpStatus.CREATED)
  enroll(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser('id') learnerId: string,
  ) {
    return this.enrollmentsService.enroll(learnerId, courseId);
  }

  @Get('enrollments/me')
  @Roles(UserRole.LEARNER)
  findMine(@CurrentUser('id') learnerId: string) {
    return this.enrollmentsService.findMine(learnerId);
  }
}
