import {
  BadRequestException,
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
  Query,
  UploadedFiles,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import {
  LESSON_MATERIAL_ALLOWED_MIME_TYPES,
  LESSON_MATERIAL_FIELD_NAME,
  LESSON_MATERIAL_MAX_SIZE_BYTES,
  LESSON_VIDEO_ALLOWED_MIME_TYPES,
  LESSON_VIDEO_FIELD_NAME,
  LESSON_VIDEO_MAX_SIZE_BYTES,
} from '../../common/constants/file.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import {
  CreateLessonDto,
  ListLessonsQueryDto,
  ReorderLessonsDto,
  UpdateLessonDto,
} from './dto/lesson.dto';
import { LessonUploadExceptionFilter } from './filters/lesson-upload-exception.filter';
import { LessonsService } from './lessons.service';

export function lessonFileFilter(
  _req: Request,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) {
  if (file.fieldname === LESSON_VIDEO_FIELD_NAME) {
    if (!LESSON_VIDEO_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      callback(
        new BadRequestException('Video must be an MP4 or WebM file'),
        false,
      );
      return;
    }
  } else if (file.fieldname === LESSON_MATERIAL_FIELD_NAME) {
    if (!LESSON_MATERIAL_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      callback(
        new BadRequestException('Material must be a PDF, DOCX or PPTX file'),
        false,
      );
      return;
    }

    if (file.size > LESSON_MATERIAL_MAX_SIZE_BYTES) {
      callback(
        new BadRequestException('Material must be at most 20 MB'),
        false,
      );
      return;
    }
  } else {
    callback(new BadRequestException('Unexpected file field'), false);
    return;
  }

  callback(null, true);
}

const lessonFileFields = [
  { name: LESSON_VIDEO_FIELD_NAME, maxCount: 1 },
  { name: LESSON_MATERIAL_FIELD_NAME, maxCount: 1 },
];

const lessonUploadOptions = {
  limits: { fileSize: LESSON_VIDEO_MAX_SIZE_BYTES },
  fileFilter: lessonFileFilter,
};

@Controller('courses/:courseId/lessons')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseFilters(LessonUploadExceptionFilter)
export class LessonsController {
  constructor(private readonly lessonsService: LessonsService) {}

  @Get()
  @Roles(UserRole.INSTRUCTOR)
  listByCourse(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser('id') instructorId: string,
    @Query() query: ListLessonsQueryDto,
  ) {
    return this.lessonsService.listByCourse(courseId, instructorId, query);
  }

  @Post()
  @Roles(UserRole.INSTRUCTOR)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileFieldsInterceptor(lessonFileFields, lessonUploadOptions))
  create(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser('id') instructorId: string,
    @Body() dto: CreateLessonDto,
    @UploadedFiles()
    files?: {
      video?: Express.Multer.File[];
      material?: Express.Multer.File[];
    },
  ) {
    return this.lessonsService.create(
      courseId,
      instructorId,
      dto,
      files?.video?.[0],
      files?.material?.[0],
    );
  }

  @Patch('reorder')
  @Roles(UserRole.INSTRUCTOR)
  @HttpCode(HttpStatus.OK)
  reorder(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser('id') instructorId: string,
    @Body() dto: ReorderLessonsDto,
  ) {
    return this.lessonsService.reorder(courseId, instructorId, dto);
  }
}

@Controller('lessons')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseFilters(LessonUploadExceptionFilter)
export class LessonDetailController {
  constructor(private readonly lessonsService: LessonsService) {}

  @Get(':id')
  @Roles(UserRole.INSTRUCTOR)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') instructorId: string,
  ) {
    return this.lessonsService.findOne(id, instructorId);
  }

  @Patch(':id')
  @Roles(UserRole.INSTRUCTOR)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileFieldsInterceptor(lessonFileFields, lessonUploadOptions))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') instructorId: string,
    @Body() dto: UpdateLessonDto,
    @UploadedFiles()
    files?: {
      video?: Express.Multer.File[];
      material?: Express.Multer.File[];
    },
  ) {
    return this.lessonsService.update(
      id,
      instructorId,
      dto,
      files?.video?.[0],
      files?.material?.[0],
    );
  }

  @Delete(':id')
  @Roles(UserRole.INSTRUCTOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') instructorId: string,
  ) {
    return this.lessonsService.remove(id, instructorId);
  }
}
