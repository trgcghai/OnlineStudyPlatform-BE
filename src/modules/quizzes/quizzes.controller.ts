import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import {
  CreateQuestionDto,
  CreateQuizDto,
  ReorderQuestionsDto,
  UpdateQuestionDto,
  UpdateQuizDto,
} from './dto/quiz.dto';
import { QuizzesService } from './quizzes.service';

@Controller('courses/:courseId/lessons/:lessonId/quiz')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QuizzesController {
  constructor(private readonly quizzesService: QuizzesService) {}

  @Post()
  @Roles(UserRole.INSTRUCTOR)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @CurrentUser('id') instructorId: string,
    @Body() dto: CreateQuizDto,
  ) {
    return this.quizzesService.create(courseId, lessonId, instructorId, dto);
  }

  @Get()
  @Roles(UserRole.INSTRUCTOR)
  list(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @CurrentUser('id') instructorId: string,
  ) {
    return this.quizzesService.findByLesson(courseId, lessonId, instructorId);
  }
}

@Controller('quizzes/:quizId/questions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QuizQuestionsController {
  constructor(private readonly quizzesService: QuizzesService) {}

  @Post()
  @Roles(UserRole.INSTRUCTOR)
  @HttpCode(HttpStatus.CREATED)
  addQuestion(
    @Param('quizId', ParseUUIDPipe) quizId: string,
    @CurrentUser('id') instructorId: string,
    @Body() dto: CreateQuestionDto,
  ) {
    return this.quizzesService.addQuestion(quizId, instructorId, dto);
  }

  @Patch('reorder')
  @Roles(UserRole.INSTRUCTOR)
  @HttpCode(HttpStatus.OK)
  reorder(
    @Param('quizId', ParseUUIDPipe) quizId: string,
    @CurrentUser('id') instructorId: string,
    @Body() dto: ReorderQuestionsDto,
  ) {
    return this.quizzesService.reorderQuestions(quizId, instructorId, dto);
  }
}

@Controller('quizzes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QuizManageController {
  constructor(private readonly quizzesService: QuizzesService) {}

  @Get(':id')
  @Roles(UserRole.INSTRUCTOR)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') instructorId: string,
  ) {
    return this.quizzesService.findOne(id, instructorId);
  }

  @Patch(':id')
  @Roles(UserRole.INSTRUCTOR)
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') instructorId: string,
    @Body() dto: UpdateQuizDto,
  ) {
    return this.quizzesService.update(id, instructorId, dto);
  }

  @Delete(':id')
  @Roles(UserRole.INSTRUCTOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') instructorId: string,
  ) {
    return this.quizzesService.remove(id, instructorId);
  }
}

@Controller('questions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QuestionManageController {
  constructor(private readonly quizzesService: QuizzesService) {}

  @Patch(':id')
  @Roles(UserRole.INSTRUCTOR)
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') instructorId: string,
    @Body() dto: UpdateQuestionDto,
  ) {
    return this.quizzesService.updateQuestion(id, instructorId, dto);
  }

  @Delete(':id')
  @Roles(UserRole.INSTRUCTOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') instructorId: string,
  ) {
    return this.quizzesService.removeQuestion(id, instructorId);
  }
}
