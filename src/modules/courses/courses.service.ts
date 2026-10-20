import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In, Not, Repository } from 'typeorm';
import { MINIO_S3_CLIENT } from '../../common/constants/file.constant';
import { FREE_COURSE_PRICE } from '../../common/constants/course.constant';
import { AuthenticatedUser } from '../auth/dto/auth.dto';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import type { LessonResponse } from '../lessons/dto/lesson.dto';
import { NotificationQueue } from '../notifications/entities/notification.entity';
import { NotificationsQueueService } from '../notifications/notifications-queue.service';
import { Question } from '../quizzes/entities/question.entity';
import { Quiz } from '../quizzes/entities/quiz.entity';
import type { QuizSummaryResponse } from '../quizzes/dto/quiz.dto';
import { UserRole } from '../users/entities/user.entity';
import { ConfigService as PaymentConfigService } from '../payments/config.service';
import { CourseAssetCleanupQueuePublisher } from './cleanup/queue/course-asset-cleanup-queue.publisher';
import { AiSummaryService } from '../ai-summary/ai-summary.service';
import { LessonSummary } from '../ai-summary/entities/lesson-summary.entity';
import { AiKnowledgeService } from '../ai-knowledge/ai-knowledge.service';
import {
  AdminCourseContentListResult,
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
  private readonly logger = new Logger(CoursesService.name);

  constructor(
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    private readonly configService: ConfigService,
    @Inject(MINIO_S3_CLIENT) private readonly s3Client: S3Client,
    private readonly notificationsQueueService: NotificationsQueueService,
    private readonly dataSource: DataSource,
    @InjectRepository(Enrollment)
    private readonly enrollmentsRepository: Repository<Enrollment>,
    @InjectRepository(Lesson)
    private readonly lessonsRepository: Repository<Lesson>,
    @InjectRepository(LessonSummary)
    private readonly summariesRepository: Repository<LessonSummary>,
    @InjectRepository(Quiz)
    private readonly quizzesRepository: Repository<Quiz>,
    @InjectRepository(Question)
    private readonly questionsRepository: Repository<Question>,
    private readonly paymentConfigService: PaymentConfigService,
    private readonly courseAssetCleanupQueue: CourseAssetCleanupQueuePublisher,
    private readonly aiSummaryService: AiSummaryService,
    private readonly aiKnowledgeService: AiKnowledgeService,
  ) {}

  async create(
    instructorId: string,
    dto: CreateCourseDto,
  ): Promise<CourseResponse> {
    const price = dto.price ?? FREE_COURSE_PRICE;
    await this.paymentConfigService.assertCoursePriceAllowed(price);

    const course = this.coursesRepository.create({
      title: dto.title.trim(),
      description: dto.description.trim(),
      category: dto.category.trim(),
      price,
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
      dto.learningOrder !== undefined ||
      dto.price !== undefined,
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

    if (dto.price !== undefined) {
      await this.paymentConfigService.assertCoursePriceAllowed(dto.price);
      course.price = dto.price;
    }

    if (course.status === CourseStatus.REJECTED) {
      course.status = CourseStatus.DRAFT;
      course.rejectReason = null;
    }

    const savedCourse = await this.coursesRepository.save(course);
    return this.toCourseResponse(savedCourse);
  }

  async remove(id: string, instructorId: string): Promise<void> {
    const course = await this.getOwnedCourseEntity(id, instructorId);
    this.assertCourseCanBeDeleted(id);

    const lessons = await this.lessonsRepository.find({
      where: { courseId: id },
    });
    const summaries =
      lessons.length > 0
        ? await this.summariesRepository.find({
            where: { lessonId: In(lessons.map((lesson) => lesson.id)) },
          })
        : [];
    const objectKeys = this.collectCourseObjectKeys(course, lessons, summaries);

    if (objectKeys.length > 0) {
      await this.courseAssetCleanupQueue.enqueue({
        courseId: id,
        objectKeys,
      });
    }

    await this.deleteCourseKnowledgeQuietly(id);
    await this.coursesRepository.delete(id);
  }

  async requestPublish(
    id: string,
    instructorId: string,
  ): Promise<CourseResponse> {
    const queryRunner = this.dataSource.createQueryRunner();

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

      if (course.price === FREE_COURSE_PRICE) {
        await this.assertFreeCourseLimitPublishable(instructorId, course.id);
      }

      course.status = CourseStatus.PENDING;
      course.rejectReason = null;
      const savedCourse = await courseRepository.save(course);

      try {
        await queryRunner.commitTransaction();
      } catch {
        throw new InternalServerErrorException(
          'Could not request course publication',
        );
      }

      try {
        this.notificationsQueueService.enqueueCreateNotification({
          kind: 'queue',
          queue: NotificationQueue.COURSE_APPROVAL,
          title: 'Yêu cầu duyệt khóa học',
          message: `${course.instructor.name} đã gửi yêu cầu xuất bản khóa học "${course.title}".`,
          actionUrl: '/admin/courses/approvals',
          metadata: { courseId: course.id, instructorId },
          sentAt: new Date().toISOString(),
          triggerKey: `course-publication-request:${course.id}`,
          triggerDate: this.getNotificationTriggerDate(),
        });
      } catch (error) {
        this.logger.error(
          'Could not enqueue course approval notification',
          error instanceof Error ? error.stack : String(error),
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
      this.notificationsQueueService.enqueueCreateNotification({
        kind: 'direct',
        targetUserId: course.instructorId,
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
        sentAt: new Date().toISOString(),
        triggerKey: `course-review:${course.id}:${dto.status}`,
        triggerDate: this.getNotificationTriggerDate(),
      });
    } catch (error) {
      this.logger.error(
        'Could not enqueue course review notification',
        error instanceof Error ? error.stack : String(error),
      );
    }

    if (dto.status === CourseStatus.PUBLISHED) {
      try {
        await this.aiSummaryService.enqueueCourse(course.id);
      } catch (error) {
        this.logger.error(
          'Could not enqueue published course summaries',
          error instanceof Error ? error.stack : String(error),
        );
      }
      try {
        await this.aiKnowledgeService.enqueueCourse(course.id);
      } catch (error) {
        this.logger.error(
          'Could not enqueue published course knowledge',
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return this.toCourseResponse(savedCourse);
  }

  private getNotificationTriggerDate(date = new Date()): string {
    return date.toISOString().slice(0, 10);
  }

  private async deleteCourseKnowledgeQuietly(courseId: string): Promise<void> {
    try {
      await this.aiKnowledgeService.deleteCourseSources(courseId);
    } catch (error) {
      this.logger.error(
        `Could not enqueue knowledge cleanup for course ${courseId}`,
        error instanceof Error ? error.stack : String(error),
      );
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

  private async assertFreeCourseLimitPublishable(
    instructorId: string,
    courseId: string,
  ): Promise<void> {
    const freeCourseLimit =
      await this.paymentConfigService.getFreeCourseLimit();

    if (freeCourseLimit === null) {
      return;
    }

    const freeCourseCount = await this.coursesRepository.count({
      where: {
        instructorId,
        price: FREE_COURSE_PRICE,
        id: Not(courseId),
        status: In([CourseStatus.PENDING, CourseStatus.PUBLISHED]),
      },
    });

    if (freeCourseCount >= freeCourseLimit) {
      throw new BadRequestException(
        `Đã đạt giới hạn ${freeCourseLimit} khóa học miễn phí. Bạn không thể xuất bản thêm khóa học miễn phí.`,
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
    const endpoint = this.configService.getOrThrow<string>(
      'MINIO_PUBLIC_ENDPOINT',
    );
    const objectKey = this.buildThumbnailObjectKey(course.id, file);

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: file.buffer,
          ContentLength: file.size,
          ContentType: file.mimetype,
        }),
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
      await this.deleteThumbnailObjectQuietly(bucket, previousThumbnail);
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

  private collectCourseObjectKeys(
    course: Course,
    lessons: Lesson[],
    summaries: LessonSummary[],
  ): string[] {
    const bucket = this.configService.getOrThrow<string>('MINIO_BUCKET');
    const endpoints = [
      this.configService.getOrThrow<string>('MINIO_ENDPOINT'),
      this.configService.get<string>('MINIO_PUBLIC_ENDPOINT'),
    ].filter((endpoint): endpoint is string => Boolean(endpoint));
    const urls = [
      course.thumbnail,
      ...lessons.flatMap((lesson) => [lesson.videoUrl, lesson.materialUrl]),
      ...summaries.map((summary) => summary.audioUrl),
    ];

    return [
      ...new Set(
        urls.flatMap((url) => {
          if (!url) return [];

          for (const endpoint of endpoints) {
            const objectKey = this.getObjectKeyFromPublicUrl(
              endpoint,
              bucket,
              url,
            );
            if (objectKey) return [objectKey];
          }

          return [];
        }),
      ),
    ];
  }

  private async deleteThumbnailObjectQuietly(
    bucket: string,
    publicUrl: string,
  ): Promise<void> {
    const endpoints = [
      this.configService.get<string>('MINIO_PUBLIC_ENDPOINT'),
      this.configService.getOrThrow<string>('MINIO_ENDPOINT'),
    ].filter((endpoint): endpoint is string => Boolean(endpoint));
    const objectKey = endpoints
      .map((endpoint) =>
        this.getObjectKeyFromPublicUrl(endpoint, bucket, publicUrl),
      )
      .find((key): key is string => key !== null);
    if (!objectKey) {
      return;
    }

    try {
      await this.s3Client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
      );
    } catch {
      // Best-effort cleanup; stale thumbnail objects must not fail the request.
    }
  }

  async listLessonsWithQuizzes(
    courseId: string,
  ): Promise<AdminCourseContentListResult> {
    const course = await this.coursesRepository.findOne({
      where: { id: courseId },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    const lessons = await this.lessonsRepository.find({
      where: { courseId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });

    const lessonIds = lessons.map((lesson) => lesson.id);
    const quizzes =
      lessonIds.length === 0
        ? []
        : await this.quizzesRepository.find({
            where: { lessonId: In(lessonIds) },
          });

    const quizIds = quizzes.map((quiz) => quiz.id);
    const questions =
      quizIds.length === 0
        ? []
        : await this.questionsRepository.find({
            where: { quizId: In(quizIds) },
          });

    const quizByLesson = new Map<string, Quiz>();
    for (const quiz of quizzes) {
      quizByLesson.set(quiz.lessonId, quiz);
    }

    const questionsByQuiz = new Map<string, Question[]>();
    for (const quiz of quizzes) {
      questionsByQuiz.set(quiz.id, []);
    }
    for (const question of questions) {
      const existing = questionsByQuiz.get(question.quizId);
      if (existing) {
        existing.push(question);
      }
    }

    const items = lessons.map((lesson) => {
      const quiz = quizByLesson.get(lesson.id) ?? null;
      const quizQuestions = quiz ? (questionsByQuiz.get(quiz.id) ?? []) : [];
      const totalPoints = quizQuestions.reduce(
        (sum, question) => sum + question.points,
        0,
      );

      return {
        lesson: this.toLessonResponse(lesson),
        quiz: quiz
          ? this.toQuizSummaryResponse(
              quiz,
              courseId,
              quizQuestions.length,
              totalPoints,
            )
          : null,
      };
    });

    return {
      items,
      total: items.length,
      courseId,
      courseTitle: course.title,
    };
  }

  private toCourseResponse(course: Course): CourseResponse {
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      category: course.category,
      price: course.price,
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
      price: course.price,
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

  private toQuizSummaryResponse(
    quiz: Quiz,
    courseId: string,
    questionCount: number,
    totalPoints: number,
  ): QuizSummaryResponse {
    return {
      id: quiz.id,
      lessonId: quiz.lessonId,
      courseId,
      title: quiz.title,
      description: quiz.description,
      timeLimitMinutes: quiz.timeLimitMinutes,
      passScore: quiz.passScore,
      totalPoints,
      passScorePoints: this.computePassScorePoints(totalPoints, quiz.passScore),
      questionCount,
      createdAt: quiz.createdAt,
      updatedAt: quiz.updatedAt,
    };
  }

  private computePassScorePoints(
    totalPoints: number,
    passScore: number,
  ): number {
    if (totalPoints <= 0) {
      return 0;
    }
    return Math.ceil((totalPoints * passScore) / 100);
  }
}
