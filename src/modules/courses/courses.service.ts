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
import { AuthenticatedUser } from '../auth/dto/auth.dto';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { NotificationQueue } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { UserRole } from '../users/entities/user.entity';
import {
  CourseApprovalListResult,
  CourseApprovalResponse,
  CourseListResult,
  CourseResponse,
  CreateCourseDto,
  ListPublishedCoursesQueryDto,
  ListCoursesQueryDto,
  PublishedCourseLimitQueryDto,
  PublicCourseListResult,
  PublicCourseLessonSummary,
  PublicCourseResponse,
  ReviewCourseStatusDto,
  UpdateCourseDto,
} from './dto/course.dto';
import {
  Course,
  CourseLearningOrder,
  CourseStatus,
} from './entities/course.entity';

@Injectable()
export class CoursesService {
  constructor(
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    private readonly configService: ConfigService,
    @Inject(MINIO_CLIENT) private readonly minioClient: MinioClient,
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
    @InjectRepository(Enrollment)
    private readonly enrollmentsRepository: Repository<Enrollment>,
    @InjectRepository(Lesson)
    private readonly lessonsRepository: Repository<Lesson>,
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
      learningOrder: dto.learningOrder ?? CourseLearningOrder.FREE,
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
    const sortBy = query.sortBy ?? 'updatedAt';
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

  async findPendingApprovals(
    query: ListCoursesQueryDto,
  ): Promise<CourseApprovalListResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const sortBy = query.sortBy ?? 'updatedAt';
    const sortOrder = query.sortOrder ?? 'DESC';

    const qb = this.coursesRepository
      .createQueryBuilder('course')
      .leftJoinAndSelect('course.instructor', 'instructor')
      .where('course.status = :status', { status: CourseStatus.PENDING });

    if (query.q) {
      qb.andWhere(
        '(course.title ILIKE :search OR course.description ILIKE :search)',
        { search: `%${query.q}%` },
      );
    }

    if (query.category) {
      qb.andWhere('course.category = :category', { category: query.category });
    }

    qb.orderBy(`course.${sortBy}`, sortOrder);

    const total = await qb.getCount();
    const courses = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return {
      items: courses.map((course) => this.toCourseApprovalResponse(course)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async findPublished(
    query: ListPublishedCoursesQueryDto,
  ): Promise<PublicCourseListResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const sortBy = query.sortBy ?? 'updatedAt';
    const sortOrder = query.sortOrder ?? 'DESC';

    const qb = this.coursesRepository
      .createQueryBuilder('course')
      .leftJoinAndSelect('course.instructor', 'instructor')
      .where('course.status = :status', { status: CourseStatus.PUBLISHED });

    if (query.q) {
      qb.andWhere(
        '(course.title ILIKE :search OR course.description ILIKE :search)',
        { search: `%${query.q}%` },
      );
    }

    if (query.category) {
      qb.andWhere('course.category = :category', { category: query.category });
    }

    qb.orderBy(`course.${sortBy}`, sortOrder);

    const total = await qb.getCount();
    const courses = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return {
      items: courses.map((course) => this.toPublicCourseResponse(course)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async findPublishedSuggestions(
    query: PublishedCourseLimitQueryDto,
  ): Promise<PublicCourseResponse[]> {
    return this.findLatestPublished(query);
  }

  async findLatestPublished(
    query: PublishedCourseLimitQueryDto,
  ): Promise<PublicCourseResponse[]> {
    const limit = query.limit ?? 10;

    const courses = await this.coursesRepository
      .createQueryBuilder('course')
      .leftJoinAndSelect('course.instructor', 'instructor')
      .where('course.status = :status', { status: CourseStatus.PUBLISHED })
      .orderBy('course.updatedAt', 'DESC')
      .take(limit)
      .getMany();

    return courses.map((course) => this.toPublicCourseResponse(course));
  }

  async getPublished(
    id: string,
    currentUser?: AuthenticatedUser | null,
  ): Promise<PublicCourseResponse> {
    const course = await this.coursesRepository.findOne({
      where: { id, status: CourseStatus.PUBLISHED },
      relations: { instructor: true },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    const lessons = await this.lessonsRepository.find({
      where: { courseId: id },
      order: { position: 'ASC' },
    });
    const response = {
      ...this.toPublicCourseResponse(course),
      lessons: lessons.map((lesson) =>
        this.toPublicCourseLessonSummary(lesson),
      ),
    };

    if (!currentUser) {
      return response;
    }

    if (currentUser.role !== UserRole.LEARNER) {
      return { ...response, isEnrolled: false };
    }

    const isEnrolled = await this.enrollmentsRepository.exists({
      where: { learnerId: currentUser.id, courseId: id },
    });

    return { ...response, isEnrolled };
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
      dto.category !== undefined ||
      dto.learningOrder !== undefined,
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

    if (dto.learningOrder !== undefined) {
      course.learningOrder = dto.learningOrder;
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

  async reviewCourseStatus(
    id: string,
    dto: ReviewCourseStatusDto,
  ): Promise<CourseResponse> {
    const course = await this.coursesRepository.findOne({
      where: { id },
      relations: { instructor: true },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    this.assertCourseStatusTransition(course.status, dto.status);

    if (dto.status === CourseStatus.REJECTED) {
      const reason = dto.rejectReason?.trim();
      if (!reason) {
        throw new BadRequestException('Rejection reason is required');
      }
      course.rejectReason = reason;
    } else {
      course.rejectReason = null;
    }

    course.status = dto.status;
    const savedCourse = await this.coursesRepository.save(course);

    try {
      await this.notificationsService.createDirectNotification({
        userId: course.instructorId,
        title:
          dto.status === CourseStatus.PUBLISHED
            ? 'Khóa học đã được duyệt'
            : 'Khóa học bị từ chối',
        message:
          dto.status === CourseStatus.PUBLISHED
            ? `Khóa học "${course.title}" đã được xuất bản.`
            : `Khóa học "${course.title}" bị từ chối: ${course.rejectReason}`,
        actionUrl: `/instructor/courses/${course.id}/edit`,
        metadata: {
          courseId: course.id,
          instructorId: course.instructorId,
          status: dto.status,
        },
        sentAt: new Date(),
      });
    } catch {
      throw new InternalServerErrorException(
        'Could not create course review notification',
      );
    }

    return this.toCourseResponse(savedCourse);
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
      learningOrder: course.learningOrder,
      instructorId: course.instructorId,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    };
  }

  private toPublicCourseResponse(course: Course): PublicCourseResponse {
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      category: course.category,
      thumbnail: course.thumbnail,
      learningOrder: course.learningOrder,
      instructorId: course.instructorId,
      instructor: course.instructor
        ? {
            id: course.instructor.id,
            name: course.instructor.name,
          }
        : undefined,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    };
  }

  private toPublicCourseLessonSummary(
    lesson: Lesson,
  ): PublicCourseLessonSummary {
    return {
      id: lesson.id,
      title: lesson.title,
      position: lesson.position,
    };
  }

  private toCourseApprovalResponse(course: Course): CourseApprovalResponse {
    return {
      ...this.toCourseResponse(course),
      instructor: {
        id: course.instructor.id,
        name: course.instructor.name,
        email: course.instructor.email,
      },
    };
  }
}
