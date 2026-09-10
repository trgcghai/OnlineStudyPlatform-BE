import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import {
  Course,
  CourseLearningOrder,
  CourseStatus,
} from '../courses/entities/course.entity';
import { QuizAttemptStatus } from '../quizzes/dto/quiz-attempt.dto';
import { Enrollment } from './entities/enrollment.entity';
import { EnrollmentsService } from './enrollments.service';

const createQueryBuilderMock = () => {
  const queryBuilder = {
    leftJoinAndSelect: jest.fn(),
    leftJoin: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    select: jest.fn(),
    addSelect: jest.fn(),
    groupBy: jest.fn(),
    getManyAndCount: jest.fn(),
    getRawMany: jest.fn(),
  };

  Object.values(queryBuilder).forEach((fn) => {
    if (typeof fn === 'function') fn.mockReturnValue(queryBuilder);
  });

  return queryBuilder;
};

describe('EnrollmentsService', () => {
  let service: EnrollmentsService;
  let enrollmentsRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    exists: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let coursesRepository: { findOne: jest.Mock };
  let lessonProgressRepository: { createQueryBuilder: jest.Mock };
  let quizAttemptsRepository: { createQueryBuilder: jest.Mock };

  const learnerId = '11111111-1111-4111-8111-111111111111';
  const courseId = '22222222-2222-4222-8222-222222222222';
  const instructorId = '33333333-3333-4333-8333-333333333333';
  const enrolledAt = new Date('2026-08-27T00:00:00.000Z');
  const updatedAt = new Date('2026-08-27T00:01:00.000Z');

  const makeCourse = (overrides: Partial<Course> = {}): Course => ({
    id: courseId,
    title: 'Lap trinh NestJS',
    description: 'Khoa hoc nhap mon NestJS',
    category: 'Backend',
    thumbnail: null,
    status: CourseStatus.PUBLISHED,
    rejectReason: null,
    learningOrder: CourseLearningOrder.FREE,
    price: 0,
    instructorId,
    instructor: {
      id: instructorId,
      name: 'Nguyen Van A',
      email: 'instructor@example.com',
    } as never,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt,
    ...overrides,
  });

  const makeEnrollment = (overrides: Partial<Enrollment> = {}): Enrollment => ({
    id: '44444444-4444-4444-8444-444444444444',
    learnerId,
    learner: {
      id: learnerId,
      name: 'Tran Thi B',
      email: 'learner@example.com',
    } as never,
    courseId,
    course: makeCourse(),
    progress: '0.00',
    enrolledAt,
    completedAt: null,
    updatedAt,
    ...overrides,
  });

  beforeEach(() => {
    enrollmentsRepository = {
      create: jest.fn((input: Partial<Enrollment>) => input),
      save: jest.fn((input: Partial<Enrollment>) =>
        Promise.resolve(makeEnrollment(input)),
      ),
      findOne: jest.fn(),
      find: jest.fn(),
      exists: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    coursesRepository = { findOne: jest.fn() };
    lessonProgressRepository = { createQueryBuilder: jest.fn() };
    quizAttemptsRepository = { createQueryBuilder: jest.fn() };
    service = new EnrollmentsService(
      enrollmentsRepository as unknown as Repository<Enrollment>,
      coursesRepository as unknown as Repository<Course>,
      lessonProgressRepository as never,
      quizAttemptsRepository as never,
    );
  });

  describe('enroll', () => {
    it('creates an enrollment for a published course with zero progress', async () => {
      coursesRepository.findOne.mockResolvedValue(makeCourse());
      enrollmentsRepository.findOne.mockResolvedValue(null);

      const result = await service.enroll(learnerId, courseId);

      expect(coursesRepository.findOne).toHaveBeenCalledWith({
        where: { id: courseId },
      });
      expect(enrollmentsRepository.findOne).toHaveBeenCalledWith({
        where: { learnerId, courseId },
      });
      expect(enrollmentsRepository.create).toHaveBeenCalledWith({
        learnerId,
        courseId,
        progress: '0.00',
        completedAt: null,
      });
      expect(result).toEqual(
        expect.objectContaining({
          learnerId,
          courseId,
          progress: '0.00',
          completedAt: null,
        }),
      );
    });

    it.each([CourseStatus.DRAFT, CourseStatus.PENDING, CourseStatus.REJECTED])(
      'rejects enrollment for %s courses',
      async (status) => {
        coursesRepository.findOne.mockResolvedValue(makeCourse({ status }));

        await expect(service.enroll(learnerId, courseId)).rejects.toEqual(
          new BadRequestException('Chỉ có thể đăng ký khóa học đã xuất bản'),
        );
        expect(enrollmentsRepository.save).not.toHaveBeenCalled();
      },
    );

    it('blocks enrollment for a paid course until payment is confirmed', async () => {
      coursesRepository.findOne.mockResolvedValue(makeCourse({ price: 99000 }));

      await expect(service.enroll(learnerId, courseId)).rejects.toEqual(
        new HttpException(
          'Khóa học trả phí. Vui lòng hoàn tất thanh toán trước khi truy cập nội dung.',
          HttpStatus.PAYMENT_REQUIRED,
        ),
      );
      expect(enrollmentsRepository.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the course does not exist', async () => {
      coursesRepository.findOne.mockResolvedValue(null);

      await expect(service.enroll(learnerId, courseId)).rejects.toEqual(
        new NotFoundException('Course not found'),
      );
    });

    it('rejects duplicate enrollment with a friendly message', async () => {
      coursesRepository.findOne.mockResolvedValue(makeCourse());
      enrollmentsRepository.findOne.mockResolvedValue(makeEnrollment());

      await expect(service.enroll(learnerId, courseId)).rejects.toEqual(
        new ConflictException('Bạn đã đăng ký khóa học này'),
      );
    });

    it('maps database unique constraint failures to duplicate enrollment', async () => {
      coursesRepository.findOne.mockResolvedValue(makeCourse());
      enrollmentsRepository.findOne.mockResolvedValue(null);
      enrollmentsRepository.save.mockRejectedValue({ code: '23505' });

      await expect(service.enroll(learnerId, courseId)).rejects.toEqual(
        new ConflictException('Bạn đã đăng ký khóa học này'),
      );
    });
  });

  describe('findMine', () => {
    it('returns current learner enrollments with course and instructor data', async () => {
      enrollmentsRepository.find.mockResolvedValue([makeEnrollment()]);

      const result = await service.findMine(learnerId);

      expect(enrollmentsRepository.find).toHaveBeenCalledWith({
        where: { learnerId },
        relations: { course: { instructor: true } },
        order: { enrolledAt: 'DESC' },
      });
      expect(result).toEqual([
        expect.objectContaining({
          learnerId,
          courseId,
          course: expect.objectContaining({
            id: courseId,
            instructor: { id: instructorId, name: 'Nguyen Van A' },
          }),
        }),
      ]);
    });
  });

  describe('findCourseEnrollmentsForInstructor', () => {
    const otherInstructorId = '55555555-5555-4555-8555-555555555555';
    const latestLessonAt = new Date('2026-09-04T10:00:00.000Z');
    const latestQuizAt = new Date('2026-09-05T10:00:00.000Z');

    it('returns paginated enrollments for an owned course with progress and summaries', async () => {
      const enrollmentQuery = createQueryBuilderMock();
      const lessonProgressQuery = createQueryBuilderMock();
      const quizAttemptQuery = createQueryBuilderMock();
      coursesRepository.findOne.mockResolvedValue(makeCourse());
      enrollmentQuery.getManyAndCount.mockResolvedValue([
        [makeEnrollment({ progress: '75.00' })],
        1,
      ]);
      lessonProgressQuery.getRawMany.mockResolvedValue([
        { learnerId, lastLessonActivityAt: latestLessonAt },
      ]);
      quizAttemptQuery.getRawMany.mockResolvedValue([
        {
          learnerId,
          bestScore: '88.50',
          latestAttemptAt: latestQuizAt,
          passedCount: '1',
          attemptCount: '2',
        },
      ]);
      enrollmentsRepository.createQueryBuilder.mockReturnValue(enrollmentQuery);
      lessonProgressRepository.createQueryBuilder.mockReturnValue(
        lessonProgressQuery,
      );
      quizAttemptsRepository.createQueryBuilder.mockReturnValue(
        quizAttemptQuery,
      );

      const result = await service.findCourseEnrollmentsForInstructor(
        instructorId,
        courseId,
        { page: 1, limit: 10 },
      );

      expect(coursesRepository.findOne).toHaveBeenCalledWith({
        where: { id: courseId },
      });
      expect(enrollmentQuery.where).toHaveBeenCalledWith(
        'enrollment.courseId = :courseId',
        { courseId },
      );
      expect(quizAttemptQuery.andWhere).toHaveBeenCalledWith(
        'attempt.status IN (:...completedStatuses)',
        {
          completedStatuses: [
            QuizAttemptStatus.PASSED,
            QuizAttemptStatus.NOT_PASSED,
          ],
        },
      );
      expect(result).toEqual({
        items: [
          {
            enrollmentId: '44444444-4444-4444-8444-444444444444',
            learner: {
              id: learnerId,
              name: 'Tran Thi B',
              email: 'learner@example.com',
            },
            enrolledAt,
            progress: '75.00',
            completionStatus: 'in_progress',
            completedAt: null,
            lastActivityAt: latestQuizAt,
            quizSummary: {
              bestScore: 88.5,
              latestAttemptAt: latestQuizAt,
              passed: true,
            },
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });

    it('applies q search to learner name and email inside the course scope', async () => {
      const enrollmentQuery = createQueryBuilderMock();
      coursesRepository.findOne.mockResolvedValue(makeCourse());
      enrollmentQuery.getManyAndCount.mockResolvedValue([[], 0]);
      enrollmentsRepository.createQueryBuilder.mockReturnValue(enrollmentQuery);

      await service.findCourseEnrollmentsForInstructor(instructorId, courseId, {
        page: 1,
        limit: 10,
        q: 'tran',
      });

      expect(enrollmentQuery.andWhere).toHaveBeenCalledWith(
        '(LOWER(learner.name) LIKE :q OR LOWER(learner.email) LIKE :q)',
        { q: '%tran%' },
      );
    });

    it('returns empty pagination without running aggregation queries when no enrollments match', async () => {
      const enrollmentQuery = createQueryBuilderMock();
      coursesRepository.findOne.mockResolvedValue(makeCourse());
      enrollmentQuery.getManyAndCount.mockResolvedValue([[], 0]);
      enrollmentsRepository.createQueryBuilder.mockReturnValue(enrollmentQuery);

      const result = await service.findCourseEnrollmentsForInstructor(
        instructorId,
        courseId,
        { page: 2, limit: 10 },
      );

      expect(result).toEqual({
        items: [],
        total: 0,
        page: 2,
        limit: 10,
        totalPages: 1,
      });
      expect(
        lessonProgressRepository.createQueryBuilder,
      ).not.toHaveBeenCalled();
      expect(quizAttemptsRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the course does not exist', async () => {
      coursesRepository.findOne.mockResolvedValue(null);

      await expect(
        service.findCourseEnrollmentsForInstructor(instructorId, courseId, {
          page: 1,
          limit: 10,
        }),
      ).rejects.toEqual(new NotFoundException('Course not found'));
    });

    it('throws ForbiddenException when the instructor does not own the course', async () => {
      coursesRepository.findOne.mockResolvedValue(
        makeCourse({ instructorId: otherInstructorId }),
      );

      await expect(
        service.findCourseEnrollmentsForInstructor(instructorId, courseId, {
          page: 1,
          limit: 10,
        }),
      ).rejects.toEqual(new ForbiddenException('You do not own this course'));
      expect(enrollmentsRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it.each([
      [
        'completed',
        makeEnrollment({ progress: '100.00', completedAt: updatedAt }),
      ],
      ['completed', makeEnrollment({ progress: '100.00', completedAt: null })],
      ['not_started', makeEnrollment({ progress: '0.00', completedAt: null })],
    ] as const)(
      'derives completionStatus %s from enrollment progress fields',
      async (completionStatus, enrollment) => {
        const enrollmentQuery = createQueryBuilderMock();
        const lessonProgressQuery = createQueryBuilderMock();
        const quizAttemptQuery = createQueryBuilderMock();
        coursesRepository.findOne.mockResolvedValue(makeCourse());
        enrollmentQuery.getManyAndCount.mockResolvedValue([[enrollment], 1]);
        lessonProgressQuery.getRawMany.mockResolvedValue([]);
        quizAttemptQuery.getRawMany.mockResolvedValue([]);
        enrollmentsRepository.createQueryBuilder.mockReturnValue(
          enrollmentQuery,
        );
        lessonProgressRepository.createQueryBuilder.mockReturnValue(
          lessonProgressQuery,
        );
        quizAttemptsRepository.createQueryBuilder.mockReturnValue(
          quizAttemptQuery,
        );

        const result = await service.findCourseEnrollmentsForInstructor(
          instructorId,
          courseId,
          { page: 1, limit: 10 },
        );

        expect(result.items[0]?.completionStatus).toBe(completionStatus);
        expect(result.items[0]?.quizSummary).toEqual({
          bestScore: null,
          latestAttemptAt: null,
          passed: null,
        });
      },
    );
  });

  describe('isLearnerEnrolled', () => {
    it('returns true when an enrollment exists', async () => {
      enrollmentsRepository.exists.mockResolvedValue(true);

      await expect(
        service.isLearnerEnrolled(learnerId, courseId),
      ).resolves.toBe(true);
      expect(enrollmentsRepository.exists).toHaveBeenCalledWith({
        where: { learnerId, courseId },
      });
    });

    it('returns false when an enrollment does not exist', async () => {
      enrollmentsRepository.exists.mockResolvedValue(false);

      await expect(
        service.isLearnerEnrolled(learnerId, courseId),
      ).resolves.toBe(false);
    });
  });
});
