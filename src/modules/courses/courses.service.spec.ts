import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AiSummaryService } from '../ai-summary/ai-summary.service';
import { AiKnowledgeService } from '../ai-knowledge/ai-knowledge.service';
import { LessonSummary } from '../ai-summary/entities/lesson-summary.entity';
import { NotificationQueue } from '../notifications/entities/notification.entity';
import { NotificationsQueueService } from '../notifications/notifications-queue.service';
import { Lesson } from '../lessons/entities/lesson.entity';
import { CoursesService } from './courses.service';
import { CreateCourseDto } from './dto/course.dto';
import {
  Course,
  CourseLearningOrder,
  CourseStatus,
} from './entities/course.entity';
import { Question, QuestionType } from '../quizzes/entities/question.entity';
import { Quiz } from '../quizzes/entities/quiz.entity';
import { CourseAssetCleanupQueuePublisher } from './cleanup/queue/course-asset-cleanup-queue.publisher';

describe('CoursesService', () => {
  let service: CoursesService;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let configService: { get: jest.Mock; getOrThrow: jest.Mock };
  let minioClient: { putObject: jest.Mock; removeObject: jest.Mock };
  let enrollmentRepo: { exists: jest.Mock };
  let lessonsRepo: { find: jest.Mock };
  let summariesRepo: { find: jest.Mock };
  let quizzesRepo: { find: jest.Mock };
  let questionsRepo: { find: jest.Mock };
  let notificationsQueueService: {
    enqueueCreateNotification: jest.Mock;
  };
  let paymentConfigService: {
    assertCoursePriceAllowed: jest.Mock;
    getFreeCourseLimit: jest.Mock;
    getCoursePricingReference: jest.Mock;
  };
  let courseAssetCleanupQueue: { enqueue: jest.Mock };
  let aiSummaryService: { enqueueCourse: jest.Mock };
  let aiKnowledgeService: {
    enqueueCourse: jest.Mock;
    deleteCourseSources: jest.Mock;
  };
  let dataSource: { createQueryRunner: jest.Mock };
  let queryRunner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    manager: { getRepository: jest.Mock };
  };

  const instructorId = '11111111-1111-4111-8111-111111111111';
  const otherInstructorId = '22222222-2222-4222-8222-222222222222';
  const courseId = '33333333-3333-4333-8333-333333333333';

  const makeCourse = (overrides: Partial<Course> = {}): Course =>
    ({
      id: courseId,
      title: 'Lap trinh NestJS',
      description: 'Khoa hoc nhap mon NestJS',
      category: 'Backend',
      thumbnail: null,
      status: CourseStatus.DRAFT,
      rejectReason: null,
      learningOrder: CourseLearningOrder.FREE,
      price: 0,
      instructorId,
      instructor: {
        id: instructorId,
        name: 'Nguyen Van A',
        email: 'instructor@example.com',
      } as never,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    }) as Course;

  const makeLesson = (overrides: Partial<Lesson> = {}): Lesson => ({
    id: '55555555-5555-4555-8555-555555555555',
    title: 'Mo dau khoa hoc',
    description: '',
    videoUrl: null,
    materialUrl: null,
    duration: 0,
    position: 0,
    courseId,
    course: makeCourse(),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

  const makeSummary = (
    overrides: Partial<LessonSummary> = {},
  ): LessonSummary => ({
    lessonId: '55555555-5555-4555-8555-555555555555',
    lesson: undefined as never,
    summaryText: null,
    status: 'pending' as never,
    error: null,
    sourceVideoUrl: null,
    audioUrl: null,
    updatedAt: null,
    ...overrides,
  });

  const makeQuiz = (overrides: Partial<Quiz> = {}): Quiz =>
    ({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      lessonId: '55555555-5555-4555-8555-555555555555',
      title: 'Bai kiem tra hoc ky',
      description: '',
      timeLimitMinutes: 10,
      passScore: 70,
      questions: [],
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    }) as Quiz;

  const makeQuestion = (overrides: Partial<Question> = {}): Question =>
    ({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      quizId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      content: 'Cau hoi kiem tra',
      type: QuestionType.MCQ,
      options: ['A', 'B'],
      correctAnswers: [0],
      points: 5,
      position: 0,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    }) as Question;

  beforeEach(() => {
    repo = {
      create: jest.fn((input: Partial<Course>) => input),
      save: jest.fn((input: Partial<Course>) => ({
        ...makeCourse(),
        ...input,
      })),
      findOne: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(),
    };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'MINIO_PUBLIC_ENDPOINT') return 'http://localhost:9000';
        return undefined;
      }),
      getOrThrow: jest.fn((key: string) => {
        if (key === 'MINIO_BUCKET') return 'lms-bucket';
        if (key === 'MINIO_ENDPOINT') return 'http://localhost:9000';
        return undefined;
      }),
    };
    minioClient = {
      putObject: jest.fn().mockResolvedValue({ etag: 'etag' }),
      removeObject: jest.fn().mockResolvedValue(undefined),
    };
    enrollmentRepo = { exists: jest.fn() };
    lessonsRepo = { find: jest.fn().mockResolvedValue([]) };
    summariesRepo = { find: jest.fn().mockResolvedValue([]) };
    quizzesRepo = { find: jest.fn().mockResolvedValue([]) };
    questionsRepo = { find: jest.fn().mockResolvedValue([]) };
    notificationsQueueService = {
      enqueueCreateNotification: jest.fn().mockResolvedValue(undefined),
    };
    paymentConfigService = {
      assertCoursePriceAllowed: jest.fn().mockResolvedValue(undefined),
      getFreeCourseLimit: jest.fn().mockResolvedValue(null),
      getCoursePricingReference: jest.fn().mockResolvedValue({
        currency: 'VND',
        allowedPrices: [0, 99000, 199000],
      }),
    };
    courseAssetCleanupQueue = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    aiSummaryService = {
      enqueueCourse: jest.fn().mockResolvedValue(undefined),
    };
    aiKnowledgeService = {
      enqueueCourse: jest.fn().mockResolvedValue(undefined),
      deleteCourseSources: jest.fn().mockResolvedValue(undefined),
    };
    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: { getRepository: jest.fn().mockReturnValue(repo) },
    };
    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };
    service = new CoursesService(
      repo as unknown as Repository<Course>,
      configService as never,
      minioClient as never,
      notificationsQueueService as unknown as NotificationsQueueService,
      dataSource as unknown as DataSource,
      enrollmentRepo as never,
      lessonsRepo as unknown as Repository<Lesson>,
      summariesRepo as unknown as Repository<LessonSummary>,
      quizzesRepo as unknown as Repository<Quiz>,
      questionsRepo as unknown as Repository<Question>,
      paymentConfigService as never,
      courseAssetCleanupQueue as unknown as CourseAssetCleanupQueuePublisher,
      aiSummaryService as unknown as AiSummaryService,
      aiKnowledgeService as unknown as AiKnowledgeService,
    );
  });

  const buildPublicQueryBuilder = (options?: {
    count?: number;
    courses?: Course[];
  }) => {
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(options?.count ?? 0),
      getMany: jest.fn().mockResolvedValue(options?.courses ?? []),
    };
    repo.createQueryBuilder.mockReturnValue(qb);
    return qb;
  };

  describe('create', () => {
    it('creates a free Draft course owned by the current Instructor', async () => {
      const dto: CreateCourseDto = {
        title: '  Lap trinh NestJS  ',
        description: '  Khoa hoc nhap mon NestJS  ',
        category: '  Backend  ',
      };

      const result = await service.create(instructorId, dto);

      expect(
        paymentConfigService.assertCoursePriceAllowed,
      ).toHaveBeenCalledWith(0);
      expect(repo.create).toHaveBeenCalledWith({
        title: 'Lap trinh NestJS',
        description: 'Khoa hoc nhap mon NestJS',
        category: 'Backend',
        price: 0,
        status: CourseStatus.DRAFT,
        learningOrder: CourseLearningOrder.FREE,
        instructorId,
      });
      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        title: 'Lap trinh NestJS',
        status: CourseStatus.DRAFT,
        instructorId,
      });
    });

    it('persists an explicit learning order on create', async () => {
      const dto: CreateCourseDto = {
        title: 'Sequential Course',
        description: 'Desc',
        category: 'Other',
        learningOrder: CourseLearningOrder.SEQUENTIAL,
      };

      await service.create(instructorId, dto);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          learningOrder: CourseLearningOrder.SEQUENTIAL,
        }),
      );
    });

    it('persists a configured price on create', async () => {
      const dto: CreateCourseDto = {
        title: 'Paid Course',
        description: 'Desc',
        category: 'Other',
        price: 99000,
      };

      await service.create(instructorId, dto);

      expect(
        paymentConfigService.assertCoursePriceAllowed,
      ).toHaveBeenCalledWith(99000);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ price: 99000 }),
      );
    });

    it('rejects a course price outside the configured price list', async () => {
      paymentConfigService.assertCoursePriceAllowed.mockRejectedValueOnce(
        new BadRequestException('Course price is not allowed'),
      );
      const dto: CreateCourseDto = {
        title: 'Paid Course',
        description: 'Desc',
        category: 'Other',
        price: 50001,
      };

      await expect(service.create(instructorId, dto)).rejects.toEqual(
        new BadRequestException('Course price is not allowed'),
      );
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('findMine', () => {
    const buildQueryBuilder = (options?: {
      count?: number;
      courses?: Course[];
    }) => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(options?.count ?? 0),
        getMany: jest.fn().mockResolvedValue(options?.courses ?? []),
      };
      repo.createQueryBuilder.mockReturnValue(qb);
      return qb;
    };

    it('scopes courses to the current Instructor and paginates', async () => {
      const qb = buildQueryBuilder({ count: 1, courses: [makeCourse()] });

      const result = await service.findMine(instructorId, {
        page: 2,
        limit: 5,
        sortBy: 'createdAt',
        sortOrder: 'DESC',
      });

      expect(qb.where).toHaveBeenCalledWith(
        'course.instructorId = :instructorId',
        { instructorId },
      );
      expect(qb.skip).toHaveBeenCalledWith(5);
      expect(qb.take).toHaveBeenCalledWith(5);
      expect(result).toEqual({
        items: [expect.objectContaining({ id: courseId })],
        total: 1,
        page: 2,
        limit: 5,
        totalPages: 1,
      });
    });

    it('applies q, category, status, and sorting filters', async () => {
      const qb = buildQueryBuilder();

      await service.findMine(instructorId, {
        page: 1,
        limit: 10,
        q: 'nestjs',
        category: 'Backend',
        status: CourseStatus.DRAFT,
        sortBy: 'title',
        sortOrder: 'ASC',
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        '(course.title ILIKE :search OR course.description ILIKE :search)',
        { search: '%nestjs%' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('course.category = :category', {
        category: 'Backend',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('course.status = :status', {
        status: CourseStatus.DRAFT,
      });
      expect(qb.orderBy).toHaveBeenCalledWith('course.title', 'ASC');
    });

    it('returns totalPages as 1 when no courses exist', async () => {
      buildQueryBuilder({ count: 0, courses: [] });

      const result = await service.findMine(instructorId, {
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'DESC',
      });

      expect(result.totalPages).toBe(1);
    });
  });

  describe('findPendingApprovals', () => {
    const buildQueryBuilder = (options?: {
      count?: number;
      courses?: Course[];
    }) => {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(options?.count ?? 0),
        getMany: jest.fn().mockResolvedValue(options?.courses ?? []),
      };
      repo.createQueryBuilder.mockReturnValue(qb);
      return qb;
    };

    it('lists only pending courses with pagination and instructor data', async () => {
      const qb = buildQueryBuilder({
        count: 1,
        courses: [makeCourse({ status: CourseStatus.PENDING })],
      });

      const result = await service.findPendingApprovals({
        page: 2,
        limit: 5,
        sortBy: 'updatedAt',
        sortOrder: 'DESC',
      });

      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
        'course.instructor',
        'instructor',
      );
      expect(qb.where).toHaveBeenCalledWith('course.status = :status', {
        status: CourseStatus.PENDING,
      });
      expect(qb.skip).toHaveBeenCalledWith(5);
      expect(qb.take).toHaveBeenCalledWith(5);
      expect(result).toEqual({
        items: [
          expect.objectContaining({
            id: courseId,
            status: CourseStatus.PENDING,
            instructor: {
              id: instructorId,
              name: 'Nguyen Van A',
              email: 'instructor@example.com',
            },
          }),
        ],
        total: 1,
        page: 2,
        limit: 5,
        totalPages: 1,
      });
    });

    it('applies q, category, and sorting filters to pending approvals', async () => {
      const qb = buildQueryBuilder();

      await service.findPendingApprovals({
        page: 1,
        limit: 10,
        q: 'nestjs',
        category: 'Backend',
        sortBy: 'title',
        sortOrder: 'ASC',
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        '(course.title ILIKE :search OR course.description ILIKE :search)',
        { search: '%nestjs%' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('course.category = :category', {
        category: 'Backend',
      });
      expect(qb.orderBy).toHaveBeenCalledWith('course.title', 'ASC');
    });
  });

  describe('findPublished', () => {
    it('lists only published courses with instructor data and pagination', async () => {
      const publishedCourse = makeCourse({ status: CourseStatus.PUBLISHED });
      const qb = buildPublicQueryBuilder({
        count: 1,
        courses: [publishedCourse],
      });

      const result = await service.findPublished({
        page: 2,
        limit: 5,
        sortBy: 'updatedAt',
        sortOrder: 'DESC',
      });

      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
        'course.instructor',
        'instructor',
      );
      expect(qb.where).toHaveBeenCalledWith('course.status = :status', {
        status: CourseStatus.PUBLISHED,
      });
      expect(qb.skip).toHaveBeenCalledWith(5);
      expect(qb.take).toHaveBeenCalledWith(5);
      expect(result).toEqual({
        items: [
          expect.objectContaining({
            id: courseId,
            instructor: { id: instructorId, name: 'Nguyen Van A' },
          }),
        ],
        total: 1,
        page: 2,
        limit: 5,
        totalPages: 1,
      });
      expect(result.items[0]).not.toHaveProperty('status');
      expect(result.items[0]).not.toHaveProperty('rejectReason');
      expect(result.items[0].instructor).not.toHaveProperty('email');
    });

    it('applies q, category, and public sorting filters', async () => {
      const qb = buildPublicQueryBuilder();

      await service.findPublished({
        page: 1,
        limit: 10,
        q: 'nestjs',
        category: 'Backend',
        sortBy: 'title',
        sortOrder: 'ASC',
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        '(course.title ILIKE :search OR course.description ILIKE :search)',
        { search: '%nestjs%' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('course.category = :category', {
        category: 'Backend',
      });
      expect(qb.orderBy).toHaveBeenCalledWith('course.title', 'ASC');
    });

    it('returns totalPages as 1 when no published courses exist', async () => {
      buildPublicQueryBuilder({ count: 0, courses: [] });

      const result = await service.findPublished({
        page: 1,
        limit: 10,
        sortBy: 'updatedAt',
        sortOrder: 'DESC',
      });

      expect(result).toEqual({
        items: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });
  });

  describe('findLatestPublished and findPublishedSuggestions', () => {
    it('returns latest published courses ordered by updatedAt DESC with requested limit', async () => {
      const qb = buildPublicQueryBuilder({
        courses: [makeCourse({ status: CourseStatus.PUBLISHED })],
      });

      const result = await service.findLatestPublished({ limit: 5 });

      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
        'course.instructor',
        'instructor',
      );
      expect(qb.where).toHaveBeenCalledWith('course.status = :status', {
        status: CourseStatus.PUBLISHED,
      });
      expect(qb.orderBy).toHaveBeenCalledWith('course.updatedAt', 'DESC');
      expect(qb.take).toHaveBeenCalledWith(5);
      expect(result).toEqual([
        expect.objectContaining({
          id: courseId,
          instructor: { id: instructorId, name: 'Nguyen Van A' },
        }),
      ]);
    });

    it('uses default latest limit when limit is missing', async () => {
      const qb = buildPublicQueryBuilder({ courses: [] });

      await service.findLatestPublished({} as never);

      expect(qb.take).toHaveBeenCalledWith(10);
    });

    it('uses latest published behavior for suggestions', async () => {
      const qb = buildPublicQueryBuilder({
        courses: [makeCourse({ status: CourseStatus.PUBLISHED })],
      });

      const result = await service.findPublishedSuggestions({ limit: 3 });

      expect(qb.where).toHaveBeenCalledWith('course.status = :status', {
        status: CourseStatus.PUBLISHED,
      });
      expect(qb.orderBy).toHaveBeenCalledWith('course.updatedAt', 'DESC');
      expect(qb.take).toHaveBeenCalledWith(3);
      expect(result).toHaveLength(1);
    });
  });

  describe('getPublished', () => {
    it('returns a published course with public instructor data', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({ status: CourseStatus.PUBLISHED }),
      );

      const result = await service.getPublished(courseId);

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: courseId, status: CourseStatus.PUBLISHED },
        relations: { instructor: true },
      });
      expect(result).toEqual(
        expect.objectContaining({
          id: courseId,
          instructor: { id: instructorId, name: 'Nguyen Van A' },
        }),
      );
      expect(result).not.toHaveProperty('status');
      expect(result).not.toHaveProperty('rejectReason');
      expect(result.instructor).not.toHaveProperty('email');
    });

    it('returns public lesson titles ordered by position on published course detail', async () => {
      const lessonB = makeLesson({
        id: '66666666-6666-4666-8666-666666666666',
        title: 'Bai 2',
        position: 1,
      });
      const lessonA = makeLesson({ title: 'Bai 1', position: 0 });
      repo.findOne.mockResolvedValue(
        makeCourse({ status: CourseStatus.PUBLISHED }),
      );
      lessonsRepo.find.mockResolvedValue([lessonA, lessonB]);

      const result = await service.getPublished(courseId);

      expect(lessonsRepo.find).toHaveBeenCalledWith({
        where: { courseId },
        order: { position: 'ASC' },
      });
      expect(result.lessons).toEqual([
        { id: lessonA.id, title: 'Bai 1', position: 0 },
        { id: lessonB.id, title: 'Bai 2', position: 1 },
      ]);
    });

    it('omits isEnrolled for anonymous public course detail', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({ status: CourseStatus.PUBLISHED }),
      );

      const result = await service.getPublished(courseId, null);

      expect(result).not.toHaveProperty('isEnrolled');
      expect(enrollmentRepo.exists).not.toHaveBeenCalled();
    });

    it('includes isEnrolled for authenticated Learners', async () => {
      const learnerId = '44444444-4444-4444-8444-444444444444';
      repo.findOne.mockResolvedValue(
        makeCourse({ status: CourseStatus.PUBLISHED }),
      );
      enrollmentRepo.exists.mockResolvedValue(true);

      const result = await service.getPublished(courseId, {
        id: learnerId,
        email: 'learner@example.com',
        role: 'Learner' as never,
        status: 'Active' as never,
      });

      expect(enrollmentRepo.exists).toHaveBeenCalledWith({
        where: { learnerId, courseId },
      });
      expect(result.isEnrolled).toBe(true);
    });

    it('returns isEnrolled false for authenticated non-Learners', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({ status: CourseStatus.PUBLISHED }),
      );

      const result = await service.getPublished(courseId, {
        id: instructorId,
        email: 'instructor@example.com',
        role: 'Instructor' as never,
        status: 'Active' as never,
      });

      expect(enrollmentRepo.exists).not.toHaveBeenCalled();
      expect(result.isEnrolled).toBe(false);
    });

    it('throws NotFoundException when the course is missing or unpublished', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.getPublished(courseId)).rejects.toEqual(
        new NotFoundException('Course not found'),
      );
    });
  });

  describe('course status transitions', () => {
    it.each([
      [CourseStatus.DRAFT, CourseStatus.PENDING],
      [CourseStatus.PENDING, CourseStatus.PUBLISHED],
      [CourseStatus.PENDING, CourseStatus.REJECTED],
      [CourseStatus.REJECTED, CourseStatus.DRAFT],
    ])('allows %s -> %s', (from, to) => {
      expect(() =>
        service.assertCourseStatusTransition(from, to),
      ).not.toThrow();
    });

    it.each([
      [CourseStatus.DRAFT, CourseStatus.PUBLISHED],
      [CourseStatus.DRAFT, CourseStatus.REJECTED],
      [CourseStatus.PENDING, CourseStatus.DRAFT],
      [CourseStatus.PUBLISHED, CourseStatus.PENDING],
      [CourseStatus.PUBLISHED, CourseStatus.REJECTED],
    ])('rejects %s -> %s', (from, to) => {
      expect(() => service.assertCourseStatusTransition(from, to)).toThrow(
        new BadRequestException(
          `Illegal course status transition: ${from} -> ${to}`,
        ),
      );
    });
  });

  describe('requestPublish', () => {
    it('moves an owned Draft course to Pending and creates a course approval queue notification', async () => {
      repo.findOne.mockResolvedValue(makeCourse());
      repo.save.mockImplementation((input: Course) => input);
      const result = await service.requestPublish(courseId, instructorId);

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: courseId },
        relations: { instructor: true },
      });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: CourseStatus.PENDING,
          rejectReason: null,
        }),
      );
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'queue',
          queue: NotificationQueue.COURSE_APPROVAL,
          title: 'Yêu cầu duyệt khóa học',
          message:
            'Nguyen Van A đã gửi yêu cầu xuất bản khóa học "Lap trinh NestJS".',
          actionUrl: '/admin/courses/approvals',
          metadata: { courseId, instructorId },
          sentAt: expect.any(String),
          triggerKey: `course-publication-request:${courseId}`,
          triggerDate: expect.any(String),
        }),
      );
      expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(CourseStatus.PENDING);
    });

    it('rejects request publish when another Instructor owns the course', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({ instructorId: otherInstructorId }),
      );

      await expect(
        service.requestPublish(courseId, instructorId),
      ).rejects.toEqual(new ForbiddenException('You do not own this course'));
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('rejects request publish for non-Draft courses', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({ status: CourseStatus.PENDING }),
      );

      await expect(
        service.requestPublish(courseId, instructorId),
      ).rejects.toEqual(
        new BadRequestException(
          'Illegal course status transition: Pending -> Pending',
        ),
      );
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('keeps request publish successful when notification enqueue fails', async () => {
      repo.findOne.mockResolvedValue(makeCourse());
      repo.save.mockImplementation((input: Course) => input);
      notificationsQueueService.enqueueCreateNotification.mockImplementation(
        () => {
          throw new Error('rabbitmq down');
        },
      );

      const result = await service.requestPublish(courseId, instructorId);

      expect(result.status).toBe(CourseStatus.PENDING);
      expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
      expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    });

    it('does not enqueue a notification when PostgreSQL commit fails', async () => {
      repo.findOne.mockResolvedValue(makeCourse());
      repo.save.mockImplementation((input: Course) => input);
      queryRunner.commitTransaction.mockRejectedValue(
        new Error('commit failed'),
      );

      await expect(
        service.requestPublish(courseId, instructorId),
      ).rejects.toEqual(
        new InternalServerErrorException(
          'Could not request course publication',
        ),
      );
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('uses a non-blocking enqueue for paid course publish requests', async () => {
      paymentConfigService.getFreeCourseLimit.mockResolvedValue(3);
      repo.findOne.mockResolvedValue(makeCourse({ price: 99000 }));
      repo.save.mockImplementation((input: Course) => input);

      await service.requestPublish(courseId, instructorId);

      expect(repo.count).not.toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: CourseStatus.PENDING }),
      );
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          triggerKey: `course-publication-request:${courseId}`,
        }),
      );
    });

    it('blocks a free course publish when the free-course limit is reached', async () => {
      paymentConfigService.getFreeCourseLimit.mockResolvedValue(3);
      repo.count.mockResolvedValue(3);
      repo.findOne.mockResolvedValue(makeCourse({ price: 0 }));
      repo.save.mockImplementation((input: Course) => input);

      await expect(
        service.requestPublish(courseId, instructorId),
      ).rejects.toEqual(
        new BadRequestException(
          'Đã đạt giới hạn 3 khóa học miễn phí. Bạn không thể xuất bản thêm khóa học miễn phí.',
        ),
      );

      expect(repo.count).toHaveBeenCalledWith({
        where: {
          instructorId,
          price: 0,
          id: expect.any(Object),
          status: expect.any(Object),
        },
      });
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('does not apply the free-course limit to paid courses', async () => {
      paymentConfigService.getFreeCourseLimit.mockResolvedValue(3);
      repo.findOne.mockResolvedValue(makeCourse({ price: 99000 }));
      repo.save.mockImplementation((input: Course) => input);
      await service.requestPublish(courseId, instructorId);

      expect(repo.count).not.toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: CourseStatus.PENDING }),
      );
    });

    it('allows a free course publish when the limit is not configured', async () => {
      paymentConfigService.getFreeCourseLimit.mockResolvedValue(null);
      repo.findOne.mockResolvedValue(makeCourse({ price: 0 }));
      repo.save.mockImplementation((input: Course) => input);
      await service.requestPublish(courseId, instructorId);

      expect(repo.count).not.toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: CourseStatus.PENDING }),
      );
    });
  });

  describe('reviewCourseStatus', () => {
    it('approves a pending course and notifies the Instructor', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({
          status: CourseStatus.PENDING,
          rejectReason: 'Old reason',
        }),
      );
      repo.save.mockImplementation((input: Course) => input);
      const result = await service.reviewCourseStatus(courseId, {
        status: CourseStatus.PUBLISHED,
      });

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: courseId },
        relations: { instructor: true },
      });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: CourseStatus.PUBLISHED,
          rejectReason: null,
        }),
      );
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).toHaveBeenCalledWith({
        kind: 'direct',
        targetUserId: instructorId,
        title: 'Khóa học đã được duyệt',
        message: 'Khóa học "Lap trinh NestJS" đã được xuất bản.',
        actionUrl: `/instructor/courses/${courseId}/edit`,
        metadata: { courseId, instructorId, status: CourseStatus.PUBLISHED },
        sentAt: expect.any(String),
        triggerKey: `course-review:${courseId}:${CourseStatus.PUBLISHED}`,
        triggerDate: expect.any(String),
      });
      expect(result.status).toBe(CourseStatus.PUBLISHED);
      expect(result.rejectReason).toBeNull();
      expect(aiSummaryService.enqueueCourse).toHaveBeenCalledWith(courseId);
    });

    it('rejects a pending course with a trimmed reason and notifies the Instructor', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({ status: CourseStatus.PENDING }),
      );
      repo.save.mockImplementation((input: Course) => input);
      const result = await service.reviewCourseStatus(courseId, {
        status: CourseStatus.REJECTED,
        rejectReason: '  Nội dung chưa đủ rõ.  ',
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: CourseStatus.REJECTED,
          rejectReason: 'Nội dung chưa đủ rõ.',
        }),
      );
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).toHaveBeenCalledWith({
        kind: 'direct',
        targetUserId: instructorId,
        title: 'Khóa học bị từ chối',
        message: 'Khóa học "Lap trinh NestJS" bị từ chối: Nội dung chưa đủ rõ.',
        actionUrl: `/instructor/courses/${courseId}/edit`,
        metadata: { courseId, instructorId, status: CourseStatus.REJECTED },
        sentAt: expect.any(String),
        triggerKey: `course-review:${courseId}:${CourseStatus.REJECTED}`,
        triggerDate: expect.any(String),
      });
      expect(result.status).toBe(CourseStatus.REJECTED);
      expect(aiSummaryService.enqueueCourse).not.toHaveBeenCalled();
      expect(result.rejectReason).toBe('Nội dung chưa đủ rõ.');
    });

    it('rejects missing rejection reason before saving', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({ status: CourseStatus.PENDING }),
      );

      await expect(
        service.reviewCourseStatus(courseId, { status: CourseStatus.REJECTED }),
      ).rejects.toEqual(
        new BadRequestException('Rejection reason is required'),
      );
      expect(repo.save).not.toHaveBeenCalled();
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).not.toHaveBeenCalled();
    });

    it('rejects non-pending approval through the status transition rule', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({ status: CourseStatus.DRAFT }),
      );

      await expect(
        service.reviewCourseStatus(courseId, {
          status: CourseStatus.PUBLISHED,
        }),
      ).rejects.toEqual(
        new BadRequestException(
          'Illegal course status transition: Draft -> Published',
        ),
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when reviewing a missing course', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.reviewCourseStatus(courseId, {
          status: CourseStatus.PUBLISHED,
        }),
      ).rejects.toEqual(new NotFoundException('Course not found'));
    });

    it('keeps review successful when Instructor notification enqueue fails', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({ status: CourseStatus.PENDING }),
      );
      repo.save.mockImplementation((input: Course) => input);
      notificationsQueueService.enqueueCreateNotification.mockImplementation(
        () => {
          throw new Error('rabbitmq down');
        },
      );

      const result = await service.reviewCourseStatus(courseId, {
        status: CourseStatus.PUBLISHED,
      });

      expect(result.status).toBe(CourseStatus.PUBLISHED);
    });

    it('keeps publication successful when AI summary enqueue fails', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({ status: CourseStatus.PENDING }),
      );
      repo.save.mockImplementation((input: Course) => input);
      aiSummaryService.enqueueCourse.mockRejectedValueOnce(
        new Error('redis down'),
      );

      const result = await service.reviewCourseStatus(courseId, {
        status: CourseStatus.PUBLISHED,
      });

      expect(result.status).toBe(CourseStatus.PUBLISHED);
      expect(aiSummaryService.enqueueCourse).toHaveBeenCalledWith(courseId);
    });
  });

  describe('getOwned and update', () => {
    it('returns an owned course detail', async () => {
      repo.findOne.mockResolvedValue(makeCourse());

      const result = await service.getOwned(courseId, instructorId);

      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: courseId } });
      expect(result).toMatchObject({ id: courseId, instructorId });
    });

    it('throws NotFoundException when the course does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.getOwned(courseId, instructorId)).rejects.toEqual(
        new NotFoundException('Course not found'),
      );
    });

    it('throws ForbiddenException when another Instructor owns the course', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({ instructorId: otherInstructorId }),
      );

      await expect(service.getOwned(courseId, instructorId)).rejects.toEqual(
        new ForbiddenException('You do not own this course'),
      );
    });

    it('includes rejection reason in owned course detail', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({
          status: CourseStatus.REJECTED,
          rejectReason: 'Nội dung khóa học chưa đủ rõ.',
        }),
      );

      const result = await service.getOwned(courseId, instructorId);

      expect(result).toMatchObject({
        status: CourseStatus.REJECTED,
        rejectReason: 'Nội dung khóa học chưa đủ rõ.',
      });
    });

    it('updates owned course metadata and trims fields', async () => {
      repo.findOne.mockResolvedValue(makeCourse());
      repo.save.mockImplementation((input: Course) => input);

      const result = await service.update(courseId, instructorId, {
        title: '  NestJS Nang cao  ',
        description: '  Noi dung moi  ',
        category: '  Backend  ',
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'NestJS Nang cao',
          description: 'Noi dung moi',
          category: 'Backend',
        }),
      );
      expect(result.title).toBe('NestJS Nang cao');
    });

    it('moves a rejected course back to Draft and clears rejectReason when the owner edits metadata', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({
          status: CourseStatus.REJECTED,
          rejectReason: 'Cần bổ sung mô tả.',
        }),
      );
      repo.save.mockImplementation((input: Course) => input);

      const result = await service.update(courseId, instructorId, {
        description: 'Mô tả đã bổ sung',
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Mô tả đã bổ sung',
          status: CourseStatus.DRAFT,
          rejectReason: null,
        }),
      );
      expect(result.status).toBe(CourseStatus.DRAFT);
      expect(result.rejectReason).toBeNull();
    });

    it('updates the course learning order', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({ learningOrder: CourseLearningOrder.FREE }),
      );
      repo.save.mockImplementation((input: Course) => input);

      const result = await service.update(courseId, instructorId, {
        learningOrder: CourseLearningOrder.SEQUENTIAL,
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          learningOrder: CourseLearningOrder.SEQUENTIAL,
        }),
      );
      expect(result.learningOrder).toBe(CourseLearningOrder.SEQUENTIAL);
    });

    it('rejects an empty update payload', async () => {
      await expect(service.update(courseId, instructorId, {})).rejects.toEqual(
        new BadRequestException('No changes provided'),
      );
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('updates the course price when it is in the configured list', async () => {
      repo.findOne.mockResolvedValue(makeCourse({ price: 0 }));
      repo.save.mockImplementation((input: Course) => input);

      const result = await service.update(courseId, instructorId, {
        price: 199000,
      });

      expect(
        paymentConfigService.assertCoursePriceAllowed,
      ).toHaveBeenCalledWith(199000);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ price: 199000 }),
      );
      expect(result.price).toBe(199000);
    });

    it('rejects a course price outside the configured list on update', async () => {
      paymentConfigService.assertCoursePriceAllowed.mockRejectedValueOnce(
        new BadRequestException('Course price is not allowed'),
      );
      repo.findOne.mockResolvedValue(makeCourse({ price: 0 }));

      await expect(
        service.update(courseId, instructorId, { price: 12345 }),
      ).rejects.toEqual(new BadRequestException('Course price is not allowed'));
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes an owned course after delete rule passes', async () => {
      repo.findOne.mockResolvedValue(makeCourse());

      await service.remove(courseId, instructorId);

      expect(repo.delete).toHaveBeenCalledWith(courseId);
      expect(courseAssetCleanupQueue.enqueue).not.toHaveBeenCalled();
    });

    it('queues every owned MinIO object before deleting the course', async () => {
      configService.getOrThrow.mockImplementation((key: string) => {
        if (key === 'MINIO_BUCKET') return 'lms-bucket';
        if (key === 'MINIO_ENDPOINT') return 'http://minio:9000';
        return undefined;
      });
      repo.findOne.mockResolvedValue(
        makeCourse({
          thumbnail: `http://localhost:9000/lms-bucket/courses/${courseId}/thumbnails/cover.png`,
        }),
      );
      lessonsRepo.find.mockResolvedValue([
        makeLesson({
          videoUrl: `http://localhost:9000/lms-bucket/lesson-imports/import-1/assets/lesson-1/videos/video.mp4`,
          materialUrl: `http://minio:9000/lms-bucket/courses/${courseId}/lessons/lesson-1/materials/guide.pdf`,
        }),
      ]);
      summariesRepo.find.mockResolvedValue([
        makeSummary({
          audioUrl: `http://minio:9000/lms-bucket/courses/${courseId}/lessons/lesson-1/summary-audio/audio.ogg`,
        }),
      ]);

      await service.remove(courseId, instructorId);

      expect(courseAssetCleanupQueue.enqueue).toHaveBeenCalledWith({
        courseId,
        objectKeys: [
          `courses/${courseId}/thumbnails/cover.png`,
          'lesson-imports/import-1/assets/lesson-1/videos/video.mp4',
          `courses/${courseId}/lessons/lesson-1/materials/guide.pdf`,
          `courses/${courseId}/lessons/lesson-1/summary-audio/audio.ogg`,
        ],
      });
      expect(
        courseAssetCleanupQueue.enqueue.mock.invocationCallOrder[0],
      ).toBeLessThan(repo.delete.mock.invocationCallOrder[0]);
    });

    it('keeps the course when RabbitMQ cannot accept its cleanup job', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({
          thumbnail: `http://localhost:9000/lms-bucket/courses/${courseId}/thumbnails/cover.png`,
        }),
      );
      courseAssetCleanupQueue.enqueue.mockRejectedValue(
        new Error('rabbitmq down'),
      );

      await expect(service.remove(courseId, instructorId)).rejects.toThrow(
        'rabbitmq down',
      );

      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('returns 403 and does not delete when another Instructor owns the course', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({ instructorId: otherInstructorId }),
      );

      await expect(service.remove(courseId, instructorId)).rejects.toEqual(
        new ForbiddenException('You do not own this course'),
      );
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });

  describe('uploadThumbnail', () => {
    const pngFile: Express.Multer.File = {
      fieldname: 'thumbnail',
      originalname: 'cover.PNG',
      encoding: '7bit',
      mimetype: 'image/png',
      size: 4,
      buffer: Buffer.from('png!'),
      stream: undefined as never,
      destination: '',
      filename: '',
      path: '',
    };

    it('uploads an owned course thumbnail and stores the public URL', async () => {
      repo.findOne.mockResolvedValue(makeCourse());
      repo.save.mockImplementation((input: Course) => input);

      const result = await service.uploadThumbnail(
        courseId,
        instructorId,
        pngFile,
      );

      expect(minioClient.putObject).toHaveBeenCalledWith(
        'lms-bucket',
        expect.stringMatching(/^courses\/33333333-.+\/thumbnails\/.+\.png$/),
        pngFile.buffer,
        pngFile.size,
        { contentType: 'image/png' },
      );
      expect(result.thumbnail).toMatch(
        /^http:\/\/localhost:9000\/lms-bucket\/courses\//,
      );
    });

    it('returns 403 before uploading when another Instructor owns the course', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({ instructorId: otherInstructorId }),
      );

      await expect(
        service.uploadThumbnail(courseId, instructorId, pngFile),
      ).rejects.toEqual(new ForbiddenException('You do not own this course'));
      expect(minioClient.putObject).not.toHaveBeenCalled();
    });

    it('removes previous thumbnail object best-effort after replacement', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({
          thumbnail:
            'http://localhost:9000/lms-bucket/courses/33333333-3333-4333-8333-333333333333/thumbnails/old.png',
        }),
      );
      repo.save.mockImplementation((input: Course) => input);

      await service.uploadThumbnail(courseId, instructorId, pngFile);

      expect(minioClient.removeObject).toHaveBeenCalledWith(
        'lms-bucket',
        'courses/33333333-3333-4333-8333-333333333333/thumbnails/old.png',
      );
    });

    it('wraps MinIO upload failures and keeps metadata unchanged', async () => {
      repo.findOne.mockResolvedValue(makeCourse());
      minioClient.putObject.mockRejectedValue(new Error('minio down'));

      await expect(
        service.uploadThumbnail(courseId, instructorId, pngFile),
      ).rejects.toEqual(
        new InternalServerErrorException('Could not upload course thumbnail'),
      );
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('listLessonsWithQuizzes', () => {
    it('returns lessons with their quiz summaries when a quiz exists', async () => {
      const lesson = makeLesson();
      const quiz = makeQuiz({ lessonId: lesson.id });
      const question = makeQuestion({ quizId: quiz.id, points: 5 });

      repo.findOne.mockResolvedValue(makeCourse());
      lessonsRepo.find.mockResolvedValue([lesson]);
      quizzesRepo.find.mockResolvedValue([quiz]);
      questionsRepo.find.mockResolvedValue([question]);

      const result = await service.listLessonsWithQuizzes(courseId);

      expect(result.total).toBe(1);
      expect(result.courseId).toBe(courseId);
      expect(result.courseTitle).toBe('Lap trinh NestJS');
      expect(result.items[0]).toMatchObject({
        lesson: { id: lesson.id, title: lesson.title, courseId },
        quiz: {
          id: quiz.id,
          lessonId: lesson.id,
          courseId,
          questionCount: 1,
          totalPoints: 5,
          passScorePoints: 4,
          passScore: 70,
        },
      });

      expect(questionsRepo.find).toHaveBeenCalledTimes(1);
      const questionQuery = questionsRepo.find.mock.calls[0][0] as {
        where: { quizId: { _value: string[] } };
      };
      expect(questionQuery.where.quizId._value).toEqual([quiz.id]);
    });

    it('returns a null quiz for a lesson without a quiz', async () => {
      const lesson = makeLesson();

      repo.findOne.mockResolvedValue(makeCourse());
      lessonsRepo.find.mockResolvedValue([lesson]);
      quizzesRepo.find.mockResolvedValue([]);

      const result = await service.listLessonsWithQuizzes(courseId);

      expect(result.total).toBe(1);
      expect(result.items[0].quiz).toBeNull();

      expect(questionsRepo.find).not.toHaveBeenCalled();
    });

    it('returns an empty list when the course has no lessons', async () => {
      repo.findOne.mockResolvedValue(makeCourse());
      lessonsRepo.find.mockResolvedValue([]);

      const result = await service.listLessonsWithQuizzes(courseId);

      expect(result).toEqual({
        items: [],
        total: 0,
        courseId,
        courseTitle: 'Lap trinh NestJS',
      });

      expect(quizzesRepo.find).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the course does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.listLessonsWithQuizzes(courseId)).rejects.toThrow(
        NotFoundException,
      );

      expect(lessonsRepo.find).not.toHaveBeenCalled();
    });
  });
});
