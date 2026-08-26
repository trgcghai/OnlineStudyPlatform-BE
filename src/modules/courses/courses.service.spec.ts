import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { NotificationQueue } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { CoursesService } from './courses.service';
import { CreateCourseDto } from './dto/course.dto';
import { Course, CourseStatus } from './entities/course.entity';

describe('CoursesService', () => {
  let service: CoursesService;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let configService: { getOrThrow: jest.Mock };
  let minioClient: { putObject: jest.Mock; removeObject: jest.Mock };
  let notificationsService: {
    createQueueNotification: jest.Mock;
    createDirectNotification: jest.Mock;
    deleteNotification: jest.Mock;
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

  const makeCourse = (overrides: Partial<Course> = {}): Course => ({
    id: courseId,
    title: 'Lap trinh NestJS',
    description: 'Khoa hoc nhap mon NestJS',
    category: 'Backend',
    thumbnail: null,
    status: CourseStatus.DRAFT,
    rejectReason: null,
    instructorId,
    instructor: {
      id: instructorId,
      name: 'Nguyen Van A',
      email: 'instructor@example.com',
    } as never,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

  beforeEach(() => {
    repo = {
      create: jest.fn((input: Partial<Course>) => input),
      save: jest.fn((input: Partial<Course>) => ({
        ...makeCourse(),
        ...input,
      })),
      findOne: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(),
    };
    configService = {
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
    notificationsService = {
      createQueueNotification: jest.fn(),
      createDirectNotification: jest.fn(),
      deleteNotification: jest.fn(),
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
      notificationsService as unknown as NotificationsService,
      dataSource as unknown as DataSource,
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
    it('creates a Draft course owned by the current Instructor', async () => {
      const dto: CreateCourseDto = {
        title: '  Lap trinh NestJS  ',
        description: '  Khoa hoc nhap mon NestJS  ',
        category: '  Backend  ',
      };

      const result = await service.create(instructorId, dto);

      expect(repo.create).toHaveBeenCalledWith({
        title: 'Lap trinh NestJS',
        description: 'Khoa hoc nhap mon NestJS',
        category: 'Backend',
        status: CourseStatus.DRAFT,
        instructorId,
      });
      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        title: 'Lap trinh NestJS',
        status: CourseStatus.DRAFT,
        instructorId,
      });
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
      notificationsService.createQueueNotification.mockResolvedValue({
        _id: 'notification-id',
      });

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
      expect(notificationsService.createQueueNotification).toHaveBeenCalledWith(
        {
          queue: NotificationQueue.COURSE_APPROVAL,
          title: 'Yêu cầu duyệt khóa học',
          message:
            'Nguyen Van A đã gửi yêu cầu xuất bản khóa học "Lap trinh NestJS".',
          actionUrl: '/admin/courses/approvals',
          metadata: { courseId, instructorId },
          sentAt: expect.any(Date),
        },
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
        notificationsService.createQueueNotification,
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
        notificationsService.createQueueNotification,
      ).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('rolls back the course update when notification creation fails', async () => {
      repo.findOne.mockResolvedValue(makeCourse());
      repo.save.mockImplementation((input: Course) => input);
      notificationsService.createQueueNotification.mockRejectedValue(
        new Error('mongo down'),
      );

      await expect(
        service.requestPublish(courseId, instructorId),
      ).rejects.toEqual(
        new InternalServerErrorException(
          'Could not queue course approval notification',
        ),
      );
      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    });

    it('deletes the created notification when PostgreSQL commit fails after Mongo creation', async () => {
      const notificationId = '64b7f8f8f8f8f8f8f8f8f8f8';
      repo.findOne.mockResolvedValue(makeCourse());
      repo.save.mockImplementation((input: Course) => input);
      notificationsService.createQueueNotification.mockResolvedValue({
        _id: notificationId,
      });
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
      expect(notificationsService.deleteNotification).toHaveBeenCalledWith(
        notificationId,
      );
      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
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
      notificationsService.createDirectNotification.mockResolvedValue({
        _id: 'notification-id',
      });

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
        notificationsService.createDirectNotification,
      ).toHaveBeenCalledWith({
        userId: instructorId,
        title: 'Khóa học đã được duyệt',
        message: 'Khóa học "Lap trinh NestJS" đã được xuất bản.',
        actionUrl: `/instructor/courses/${courseId}/edit`,
        metadata: { courseId, instructorId, status: CourseStatus.PUBLISHED },
        sentAt: expect.any(Date),
      });
      expect(result.status).toBe(CourseStatus.PUBLISHED);
      expect(result.rejectReason).toBeNull();
    });

    it('rejects a pending course with a trimmed reason and notifies the Instructor', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({ status: CourseStatus.PENDING }),
      );
      repo.save.mockImplementation((input: Course) => input);
      notificationsService.createDirectNotification.mockResolvedValue({
        _id: 'notification-id',
      });

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
        notificationsService.createDirectNotification,
      ).toHaveBeenCalledWith({
        userId: instructorId,
        title: 'Khóa học bị từ chối',
        message: 'Khóa học "Lap trinh NestJS" bị từ chối: Nội dung chưa đủ rõ.',
        actionUrl: `/instructor/courses/${courseId}/edit`,
        metadata: { courseId, instructorId, status: CourseStatus.REJECTED },
        sentAt: expect.any(Date),
      });
      expect(result.status).toBe(CourseStatus.REJECTED);
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
        notificationsService.createDirectNotification,
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

    it('fails the review when Instructor notification creation fails', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({ status: CourseStatus.PENDING }),
      );
      repo.save.mockImplementation((input: Course) => input);
      notificationsService.createDirectNotification.mockRejectedValue(
        new Error('mongo down'),
      );

      await expect(
        service.reviewCourseStatus(courseId, {
          status: CourseStatus.PUBLISHED,
        }),
      ).rejects.toEqual(
        new InternalServerErrorException(
          'Could not create course review notification',
        ),
      );
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

    it('rejects an empty update payload', async () => {
      await expect(service.update(courseId, instructorId, {})).rejects.toEqual(
        new BadRequestException('No changes provided'),
      );
      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes an owned course after delete rule passes', async () => {
      repo.findOne.mockResolvedValue(makeCourse());

      await service.remove(courseId, instructorId);

      expect(repo.delete).toHaveBeenCalledWith(courseId);
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
});
