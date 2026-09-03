import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import {
  GradeEssayAnswerDto,
  ListEssayGradingSubmissionsQueryDto,
} from './dto/essay-grading.dto';
import { EssayGradingService } from './essay-grading.service';

@Controller('courses/:courseId/quizzes/:quizId/essay-grading')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EssayGradingController {
  constructor(private readonly essayGradingService: EssayGradingService) {}

  @Get()
  @Roles(UserRole.INSTRUCTOR)
  listSubmissions(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('quizId', ParseUUIDPipe) quizId: string,
    @CurrentUser('id') instructorId: string,
    @Query() query: ListEssayGradingSubmissionsQueryDto,
  ) {
    return this.essayGradingService.listSubmissions(
      instructorId,
      courseId,
      quizId,
      query,
    );
  }

  @Patch('attempts/:attemptId/essay/:questionId')
  @Roles(UserRole.INSTRUCTOR)
  @HttpCode(HttpStatus.OK)
  gradeEssay(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('quizId', ParseUUIDPipe) quizId: string,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @CurrentUser('id') instructorId: string,
    @Body() dto: GradeEssayAnswerDto,
  ) {
    return this.essayGradingService.gradeEssay(
      instructorId,
      courseId,
      quizId,
      attemptId,
      questionId,
      dto,
    );
  }
}
