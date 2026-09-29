import {
  Body,
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
import { Cached, InvalidateCache } from '../redis/redis.decorators';
import { UserRole } from '../users/entities/user.entity';
import { SubmitQuizAttemptDto } from './dto/quiz-attempt.dto';
import { QuizAttemptsService } from './quiz-attempts.service';

@Controller('learning/courses/:courseId/lessons/:lessonId/quiz')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LearnerQuizzesController {
  constructor(private readonly quizAttemptsService: QuizAttemptsService) {}

  @Get()
  @Cached({ namespace: 'learning:quiz', ttl: 60, scope: 'user' })
  @Roles(UserRole.LEARNER)
  loadQuiz(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @CurrentUser('id') learnerId: string,
  ) {
    return this.quizAttemptsService.loadLearnerQuiz(
      learnerId,
      courseId,
      lessonId,
    );
  }

  @Post(':quizId/attempts')
  @InvalidateCache([
    'learning:quiz',
    'learning:quiz-attempts',
    'dashboard:learner',
  ])
  @Roles(UserRole.LEARNER)
  @HttpCode(HttpStatus.CREATED)
  startAttempt(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Param('quizId', ParseUUIDPipe) quizId: string,
    @CurrentUser('id') learnerId: string,
  ) {
    return this.quizAttemptsService.startAttempt(
      learnerId,
      courseId,
      lessonId,
      quizId,
    );
  }

  @Post(':quizId/attempts/:attemptId/submit')
  @InvalidateCache([
    'learning:quiz',
    'learning:quiz-attempts',
    'learning:course',
    'learning:lesson',
    'dashboard:learner',
  ])
  @Roles(UserRole.LEARNER)
  @HttpCode(HttpStatus.OK)
  submitAttempt(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Param('quizId', ParseUUIDPipe) quizId: string,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser('id') learnerId: string,
    @Body() dto: SubmitQuizAttemptDto,
  ) {
    return this.quizAttemptsService.submitAttempt(
      learnerId,
      courseId,
      lessonId,
      quizId,
      attemptId,
      dto,
    );
  }

  @Get(':quizId/attempts')
  @Cached({ namespace: 'learning:quiz-attempts', ttl: 30, scope: 'user' })
  @Roles(UserRole.LEARNER)
  listAttempts(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Param('quizId', ParseUUIDPipe) quizId: string,
    @CurrentUser('id') learnerId: string,
  ) {
    return this.quizAttemptsService.listAttempts(
      learnerId,
      courseId,
      lessonId,
      quizId,
    );
  }
}
