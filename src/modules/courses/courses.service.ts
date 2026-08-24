import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import type { Types } from 'mongoose';
import type { Client as MinioClient } from 'minio';
import { DataSource, Repository } from 'typeorm';
import { MINIO_CLIENT } from '../../common/constants/file.constant';
import { NotificationQueue } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CourseListResult,
  CourseResponse,
  CreateCourseDto,
  ListCoursesQueryDto,
  UpdateCourseDto,
} from './dto/course.dto';
import { Course, CourseStatus } from './entities/course.entity';

@Injectable()
export class CoursesService {
  constructor(
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    private readonly configService: ConfigService,
    @Inject(MINIO_CLIENT) private readonly minioClient: MinioClient,
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    instructorId: string,
    dto: CreateCourseDto,
  ): Promise<CourseResponse> {
    const course = this.coursesRepository.create({
      title: dto.title.trim(),
      description: dto.description.trim(),
      category: dto.category.trim(),
      status: CourseStatus.DRAFT,
      instructorId,
    });

    const savedCourse = await this.coursesRepository.save(course);
    return this.toCourseResponse(savedCourse);
  }

  async findMine(
    instructorId: string,
    query: ListCoursesQueryDto,
  ): Promise<CourseListResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'DESC';

    const qb = this.coursesRepository
      .createQueryBuilder('course')
      .where('course.instructorId = :instructorId', { instructorId });

    if (query.q) {
      qb.andWhere(
        '(course.title ILIKE :search OR course.description ILIKE :search)',
        { search: `%${query.q}%` },
      );
    }

    if (query.category) {
      qb.andWhere('course.category = :category', { category: query.category });
    }

    if (query.status) {
      qb.andWhere('course.status = :status', { status: query.status });
    }

    qb.orderBy(`course.${sortBy}`, sortOrder);

    const total = await qb.getCount();
    const courses = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return {
      items: courses.map((course) => this.toCourseResponse(course)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getOwned(id: string, instructorId: string): Promise<CourseResponse> {
    const course = await this.getOwnedCourseEntity(id, instructorId);
    return this.toCourseResponse(course);
  }

  async update(
    id: string,
    instructorId: string,
    dto: UpdateCourseDto,
  ): Promise<CourseResponse> {
    const hasChanges = Boolean(
      dto.title !== undefined ||
      dto.description !== undefined ||
      dto.category !== undefined,
    );

    if (!hasChanges) {
      throw new BadRequestException('No changes provided');
    }

    const course = await this.getOwnedCourseEntity(id, instructorId);

    if (dto.title !== undefined) {
      course.title = dto.title.trim();
    }

    if (dto.description !== undefined) {
      course.description = dto.description.trim();
    }

    if (dto.category !== undefined) {
      course.category = dto.category.trim();
    }

    if (course.status === CourseStatus.REJECTED) {
      course.status = CourseStatus.DRAFT;
      course.rejectReason = null;
    }

    const savedCourse = await this.coursesRepository.save(course);
    return this.toCourseResponse(savedCourse);
  }

  async remove(id: string, instructorId: string): Promise<void> {
    await this.getOwnedCourseEntity(id, instructorId);
    this.assertCourseCanBeDeleted(id);
    await this.coursesRepository.delete(id);
  }

  async requestPublish(
    id: string,
    instructorId: string,
  ): Promise<CourseResponse> {
    const queryRunner = this.dataSource.createQueryRunner();
    let createdNotificationId: Types.ObjectId | string | undefined;

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const courseRepository = queryRunner.manager.getRepository(Course);
      const course = await courseRepository.findOne({
        where: { id },
        relations: { instructor: true },
      });

      if (!course) {
        throw new NotFoundException('Course not found');
      }

      if (course.instructorId !== instructorId) {
        throw new ForbiddenException('You do not own this course');
      }

      this.assertCourseStatusTransition(course.status, CourseStatus.PENDING);

      course.status = CourseStatus.PENDING;
      course.rejectReason = null;
      const savedCourse = await courseRepository.save(course);

      try {
        const notification =
          await this.notificationsService.createQueueNotification({
            queue: NotificationQueue.COURSE_APPROVAL,
            title: 'Yêu cầu duyệt khóa học',
            message: `${course.instructor.name} đã gửi yêu cầu xuất bản khóa học "${course.title}".`,
            actionUrl: '/admin/courses/approvals',
            metadata: { courseId: course.id, instructorId },
            sentAt: new Date(),
          });
        createdNotificationId = notification._id;
      } catch {
        throw new InternalServerErrorException(
          'Could not queue course approval notification',
        );
      }

      try {
        await queryRunner.commitTransaction();
      } catch {
        if (createdNotificationId) {
          await this.notificationsService.deleteNotification(
            createdNotificationId,
          );
        }
        throw new InternalServerErrorException(
          'Could not request course publication',
        );
      }

      return this.toCourseResponse(savedCourse);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  assertCourseStatusTransition(from: CourseStatus, to: CourseStatus): void {
    const legalTransitions: Partial<Record<CourseStatus, CourseStatus[]>> = {
      [CourseStatus.DRAFT]: [CourseStatus.PENDING],
      [CourseStatus.PENDING]: [CourseStatus.PUBLISHED, CourseStatus.REJECTED],
      [CourseStatus.REJECTED]: [CourseStatus.DRAFT],
    };

    if (!legalTransitions[from]?.includes(to)) {
      throw new BadRequestException(
        `Illegal course status transition: ${from} -> ${to}`,
      );
    }
  }

  async uploadThumbnail(
    id: string,
    instructorId: string,
    file: Express.Multer.File,
  ): Promise<CourseResponse> {
    if (!file) {
      throw new BadRequestException('Course thumbnail is required');
    }

    const course = await this.getOwnedCourseEntity(id, instructorId);
    const bucket = this.configService.getOrThrow<string>('MINIO_BUCKET');
    const endpoint = this.configService.getOrThrow<string>('MINIO_ENDPOINT');
    const objectKey = this.buildThumbnailObjectKey(course.id, file);

    try {
      await this.minioClient.putObject(
        bucket,
        objectKey,
        file.buffer,
        file.size,
        { contentType: file.mimetype },
      );
    } catch {
      throw new InternalServerErrorException(
        'Could not upload course thumbnail',
      );
    }

    const previousThumbnail = course.thumbnail;
    course.thumbnail = this.buildPublicObjectUrl(endpoint, bucket, objectKey);
    const savedCourse = await this.coursesRepository.save(course);

    if (previousThumbnail) {
      await this.deleteThumbnailObjectQuietly(
        endpoint,
        bucket,
        previousThumbnail,
      );
    }

    return this.toCourseResponse(savedCourse);
  }

  private async getOwnedCourseEntity(
    id: string,
    instructorId: string,
  ): Promise<Course> {
    const course = await this.coursesRepository.findOne({ where: { id } });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (course.instructorId !== instructorId) {
      throw new ForbiddenException('You do not own this course');
    }

    return course;
  }

  private assertCourseCanBeDeleted(courseId: string): void {
    void courseId;
  }

  private buildThumbnailObjectKey(
    courseId: string,
    file: Express.Multer.File,
  ): string {
    const extension = this.extractImageExtension(
      file.originalname,
      file.mimetype,
    );
    return `courses/${courseId}/thumbnails/${randomUUID()}${extension}`;
  }

  private extractImageExtension(
    originalName: string,
    mimetype: string,
  ): string {
    const extensionFromName = originalName.includes('.')
      ? originalName.slice(originalName.lastIndexOf('.')).toLowerCase()
      : '';

    if (/^\.[a-z0-9]{1,5}$/.test(extensionFromName)) {
      return extensionFromName;
    }

    const mimeExtensions: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
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

  private async deleteThumbnailObjectQuietly(
    endpoint: string,
    bucket: string,
    publicUrl: string,
  ): Promise<void> {
    const objectKey = this.getObjectKeyFromPublicUrl(
      endpoint,
      bucket,
      publicUrl,
    );
    if (!objectKey) {
      return;
    }

    try {
      await this.minioClient.removeObject(bucket, objectKey);
    } catch {
      // Best-effort cleanup; stale thumbnail objects must not fail the request.
    }
  }

  private toCourseResponse(course: Course): CourseResponse {
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      category: course.category,
      thumbnail: course.thumbnail,
      status: course.status,
      rejectReason: course.rejectReason,
      instructorId: course.instructorId,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    };
  }
}
