import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Cached, InvalidateCache } from '../redis/redis.decorators';
import { UserRole } from '../users/entities/user.entity';
import { CreateWatchEventDto } from './dto/watch-event.dto';
import { LearningProgressService } from './learning-progress.service';
import { LearningService } from './learning.service';

@Controller('learning/courses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.LEARNER)
export class LearningController {
  constructor(
    private readonly learningService: LearningService,
    private readonly learningProgressService: LearningProgressService,
  ) {}

  @Get(':courseId')
  @Cached({ namespace: 'learning:course', ttl: 60, scope: 'user' })
  getCourse(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser('id') learnerId: string,
  ) {
    return this.learningService.getCourseLearning(learnerId, courseId);
  }

  @Get(':courseId/lessons/:lessonId')
  @Cached({ namespace: 'learning:lesson', ttl: 30, scope: 'user' })
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

  @Get(':courseId/lessons/:lessonId/summary')
  getLessonSummary(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @CurrentUser('id') learnerId: string,
  ) {
    return this.learningService.getLessonSummary(learnerId, courseId, lessonId);
  }

  @Post(':courseId/lessons/:lessonId/watch-events')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @InvalidateCache(['learning:course', 'learning:lesson', 'dashboard:learner'])
  recordWatchEvent(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @CurrentUser('id') learnerId: string,
    @Body() dto: CreateWatchEventDto,
  ) {
    return this.learningProgressService.recordWatchEvent(
      learnerId,
      courseId,
      lessonId,
      dto,
    );
  }
}
