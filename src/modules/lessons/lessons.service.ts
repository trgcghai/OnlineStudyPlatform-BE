import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import type { Client as MinioClient } from 'minio';
import { DataSource, Repository } from 'typeorm';
import { MINIO_CLIENT } from '../../common/constants/file.constant';
import { Course } from '../courses/entities/course.entity';
import {
  CreateLessonDto,
  LessonListResult,
  LessonResponse,
  ListLessonsQueryDto,
  ReorderLessonsDto,
  UpdateLessonDto,
} from './dto/lesson.dto';
import { Lesson } from './entities/lesson.entity';

@Injectable()
export class LessonsService {
  constructor(
    @InjectRepository(Lesson)
    private readonly lessonsRepository: Repository<Lesson>,
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    private readonly configService: ConfigService,
    @Inject(MINIO_CLIENT) private readonly minioClient: MinioClient,
    private readonly dataSource: DataSource,
  ) {}

  async listByCourse(
    courseId: string,
    instructorId: string,
    query: ListLessonsQueryDto,
  ): Promise<LessonListResult> {
    await this.assertCourseOwnership(courseId, instructorId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const [items, total] = await this.lessonsRepository.findAndCount({
      where: { courseId },
      order: { position: 'ASC', createdAt: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: items.map((l) => this.toLessonResponse(l)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async findOne(id: string, instructorId: string): Promise<LessonResponse> {
    const lesson = await this.getOwnedLessonEntity(id, instructorId);
    return this.toLessonResponse(lesson);
  }

  async create(
    courseId: string,
    instructorId: string,
    dto: CreateLessonDto,
    videoFile?: Express.Multer.File,
    materialFile?: Express.Multer.File,
  ): Promise<LessonResponse> {
    await this.assertCourseOwnership(courseId, instructorId);

    const maxPosition = await this.lessonsRepository.maximum('position', {
      courseId,
    });
    const nextPosition = (maxPosition ?? -1) + 1;

    const lesson = this.lessonsRepository.create({
      title: dto.title.trim(),
      description: dto.description?.trim() ?? '',
      duration: dto.duration ?? 0,
      position: nextPosition,
      courseId,
    });

    const savedLesson = await this.lessonsRepository.save(lesson);
    const uploadedKeys: { bucket: string; key: string }[] = [];

    try {
      if (videoFile) {
        const videoKey = await this.uploadFile(
          savedLesson.courseId,
          savedLesson.id,
          videoFile,
          'videos',
        );
        uploadedKeys.push({
          bucket: this.configService.getOrThrow<string>('MINIO_BUCKET'),
          key: videoKey,
        });
        savedLesson.videoUrl = this.buildPublicObjectUrl(
          this.configService.getOrThrow<string>('MINIO_ENDPOINT'),
          this.configService.getOrThrow<string>('MINIO_BUCKET'),
          videoKey,
        );
      }

      if (materialFile) {
        const materialKey = await this.uploadFile(
          savedLesson.courseId,
          savedLesson.id,
          materialFile,
          'materials',
        );
        uploadedKeys.push({
          bucket: this.configService.getOrThrow<string>('MINIO_BUCKET'),
          key: materialKey,
        });
        savedLesson.materialUrl = this.buildPublicObjectUrl(
          this.configService.getOrThrow<string>('MINIO_ENDPOINT'),
          this.configService.getOrThrow<string>('MINIO_BUCKET'),
          materialKey,
        );
      }

      await this.lessonsRepository.save(savedLesson);
      return this.toLessonResponse(savedLesson);
    } catch (error) {
      await this.cleanupUploadedFiles(uploadedKeys);
      throw error;
    }
  }

  async update(
    id: string,
    instructorId: string,
    dto: UpdateLessonDto,
    videoFile?: Express.Multer.File,
    materialFile?: Express.Multer.File,
  ): Promise<LessonResponse> {
    const lesson = await this.getOwnedLessonEntity(id, instructorId);
    const bucket = this.configService.getOrThrow<string>('MINIO_BUCKET');
    const endpoint = this.configService.getOrThrow<string>('MINIO_ENDPOINT');

    if (dto.title !== undefined) {
      lesson.title = dto.title.trim();
    }

    if (dto.description !== undefined) {
      lesson.description = dto.description.trim();
    }

    if (dto.duration !== undefined) {
      lesson.duration = dto.duration;
    }

    const keysToDelete: { bucket: string; key: string }[] = [];

    if (videoFile) {
      if (lesson.videoUrl) {
        const oldKey = this.getObjectKeyFromPublicUrl(
          endpoint,
          bucket,
          lesson.videoUrl,
        );
        if (oldKey) keysToDelete.push({ bucket, key: oldKey });
      }
      const videoKey = await this.uploadFile(
        lesson.courseId,
        lesson.id,
        videoFile,
        'videos',
      );
      lesson.videoUrl = this.buildPublicObjectUrl(endpoint, bucket, videoKey);
    }

    if (materialFile) {
      if (lesson.materialUrl) {
        const oldKey = this.getObjectKeyFromPublicUrl(
          endpoint,
          bucket,
          lesson.materialUrl,
        );
        if (oldKey) keysToDelete.push({ bucket, key: oldKey });
      }
      const materialKey = await this.uploadFile(
        lesson.courseId,
        lesson.id,
        materialFile,
        'materials',
      );
      lesson.materialUrl = this.buildPublicObjectUrl(
        endpoint,
        bucket,
        materialKey,
      );
    }

    const savedLesson = await this.lessonsRepository.save(lesson);

    await this.deleteObjectsQuietly(keysToDelete);

    return this.toLessonResponse(savedLesson);
  }

  async remove(id: string, instructorId: string): Promise<void> {
    const lesson = await this.getOwnedLessonEntity(id, instructorId);
    const bucket = this.configService.getOrThrow<string>('MINIO_BUCKET');
    const endpoint = this.configService.getOrThrow<string>('MINIO_ENDPOINT');

    const keysToDelete: { bucket: string; key: string }[] = [];

    if (lesson.videoUrl) {
      const key = this.getObjectKeyFromPublicUrl(
        endpoint,
        bucket,
        lesson.videoUrl,
      );
      if (key) keysToDelete.push({ bucket, key });
    }

    if (lesson.materialUrl) {
      const key = this.getObjectKeyFromPublicUrl(
        endpoint,
        bucket,
        lesson.materialUrl,
      );
      if (key) keysToDelete.push({ bucket, key });
    }

    await this.lessonsRepository.remove(lesson);

    await this.deleteObjectsQuietly(keysToDelete);

    await this.reindexPositions(lesson.courseId);
  }

  async reorder(
    courseId: string,
    instructorId: string,
    dto: ReorderLessonsDto,
  ): Promise<LessonResponse[]> {
    await this.assertCourseOwnership(courseId, instructorId);

    const existingLessons = await this.lessonsRepository.find({
      where: { courseId },
    });

    const existingIds = new Set(existingLessons.map((l) => l.id));
    const dtoIds = new Set(dto.orderedIds);

    if (dto.orderedIds.length !== existingIds.size) {
      throw new BadRequestException(
        'Ordered IDs length must match the number of lessons in the course',
      );
    }

    for (const id of dto.orderedIds) {
      if (!existingIds.has(id)) {
        throw new BadRequestException(
          `Lesson ${id} does not belong to this course`,
        );
      }
    }

    for (const id of existingIds) {
      if (!dtoIds.has(id)) {
        throw new BadRequestException(
          `Lesson ${id} is missing from the ordered list`,
        );
      }
    }

    const updates = dto.orderedIds.map((id, index) =>
      this.lessonsRepository.update({ id, courseId }, { position: index }),
    );

    await Promise.all(updates);

    const reordered = await this.lessonsRepository.find({
      where: { courseId },
      order: { position: 'ASC' },
    });

    return reordered.map((l) => this.toLessonResponse(l));
  }

  async assertCourseOwnership(courseId: string, instructorId: string) {
    const course = await this.coursesRepository.findOne({
      where: { id: courseId },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (course.instructorId !== instructorId) {
      throw new ForbiddenException('You do not own this course');
    }

    return course;
  }

  private async getOwnedLessonEntity(
    id: string,
    instructorId: string,
  ): Promise<Lesson> {
    const lesson = await this.lessonsRepository.findOne({
      where: { id },
      relations: { course: true },
    });

    if (!lesson) {
      throw new NotFoundException('Lesson not found');
    }

    if (lesson.course.instructorId !== instructorId) {
      throw new ForbiddenException('You do not own this lesson');
    }

    return lesson;
  }

  private async reindexPositions(courseId: string): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const lessons = await queryRunner.manager.find(Lesson, {
        where: { courseId },
        order: { position: 'ASC', createdAt: 'ASC' },
      });

      for (let index = 0; index < lessons.length; index++) {
        await queryRunner.manager.update(Lesson, lessons[index].id, {
          position: index,
        });
      }

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  private async uploadFile(
    courseId: string,
    lessonId: string,
    file: Express.Multer.File,
    subfolder: string,
  ): Promise<string> {
    const bucket = this.configService.getOrThrow<string>('MINIO_BUCKET');
    const extension = this.extractExtension(file.originalname, file.mimetype);
    const objectKey = `courses/${courseId}/lessons/${lessonId}/${subfolder}/${randomUUID()}${extension}`;

    await this.minioClient.putObject(
      bucket,
      objectKey,
      file.buffer,
      file.size,
      {
        contentType: file.mimetype,
      },
    );

    return objectKey;
  }

  private extractExtension(originalName: string, mimetype: string): string {
    const extensionFromName = originalName.includes('.')
      ? originalName.slice(originalName.lastIndexOf('.')).toLowerCase()
      : '';

    if (/^\.[a-z0-9]{1,5}$/.test(extensionFromName)) {
      return extensionFromName;
    }

    const mimeExtensions: Record<string, string> = {
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'application/pdf': '.pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        '.docx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        '.pptx',
    };

    return mimeExtensions[mimetype] ?? '';
  }

  private buildPublicObjectUrl(
    endpoint: string,
    bucket: string,
    objectKey: string,
  ): string {
    return `${endpoint.replace(/\/+$/, '')}/${bucket}/${objectKey}`;
  }

  private getObjectKeyFromPublicUrl(
    endpoint: string,
    bucket: string,
    publicUrl: string,
  ): string | null {
    const prefix = this.buildPublicObjectUrl(endpoint, bucket, '');
    return publicUrl.startsWith(prefix) ? publicUrl.slice(prefix.length) : null;
  }

  private async cleanupUploadedFiles(
    keys: { bucket: string; key: string }[],
  ): Promise<void> {
    await this.deleteObjectsQuietly(keys);
  }

  private async deleteObjectsQuietly(
    keys: { bucket: string; key: string }[],
  ): Promise<void> {
    for (const { bucket, key } of keys) {
      try {
        await this.minioClient.removeObject(bucket, key);
      } catch {
        // Best-effort cleanup; stale objects must not fail the request.
      }
    }
  }

  private toLessonResponse(lesson: Lesson): LessonResponse {
    return {
      id: lesson.id,
      title: lesson.title,
      description: lesson.description,
      videoUrl: lesson.videoUrl,
      materialUrl: lesson.materialUrl,
      duration: lesson.duration,
      position: lesson.position,
      courseId: lesson.courseId,
      createdAt: lesson.createdAt,
      updatedAt: lesson.updatedAt,
    };
  }
}
