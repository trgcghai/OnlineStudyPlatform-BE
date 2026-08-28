import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { LearningService } from './learning.service';

@Controller('learning/courses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.LEARNER)
export class LearningController {
  constructor(private readonly learningService: LearningService) {}

  @Get(':courseId')
  getCourse(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser('id') learnerId: string,
  ) {
    return this.learningService.getCourseLearning(learnerId, courseId);
  }

  @Get(':courseId/lessons/:lessonId')
  getLesson(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @CurrentUser('id') learnerId: string,
  ) {
    return this.learningService.getLessonLearning(
      learnerId,
      courseId,
      lessonId,
    );
  }
}
