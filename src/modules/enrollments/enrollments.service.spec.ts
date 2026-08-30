import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import {
  Course,
  CourseLearningOrder,
  CourseStatus,
} from '../courses/entities/course.entity';
import { Enrollment } from './entities/enrollment.entity';
import { EnrollmentsService } from './enrollments.service';

describe('EnrollmentsService', () => {
  let service: EnrollmentsService;
  let enrollmentsRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    exists: jest.Mock;
  };
  let coursesRepository: { findOne: jest.Mock };

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
    learner: { id: learnerId } as never,
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
    };
    coursesRepository = { findOne: jest.fn() };
    service = new EnrollmentsService(
      enrollmentsRepository as unknown as Repository<Enrollment>,
      coursesRepository as unknown as Repository<Course>,
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
