import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import {
  Course,
  CourseLearningOrder,
  CourseStatus,
} from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import {
  LearningAccessService,
  SEQUENTIAL_BLOCK_MESSAGE,
} from '../lessons/learning-access.service';
import { LearningService } from './learning.service';

describe('LearningService', () => {
  let service: LearningService;
  let coursesRepository: { findOne: jest.Mock };
  let lessonsRepository: { find: jest.Mock; findOne: jest.Mock };
  let enrollmentsRepository: { findOne: jest.Mock };

  const learnerId = '11111111-1111-4111-8111-111111111111';
  const courseId = '22222222-2222-4222-8222-222222222222';
  const otherCourseId = '33333333-3333-4333-8333-333333333333';
  const enrollmentId = '44444444-4444-4444-8444-444444444444';
  const enrolledAt = new Date('2026-08-28T00:00:00.000Z');
  const updatedAt = new Date('2026-08-28T00:01:00.000Z');

  const makeCourse = (overrides: Partial<Course> = {}): Course => ({
    id: courseId,
    title: 'Lap trinh NestJS',
    description: 'Khoa hoc nhap mon NestJS',
    category: 'Backend',
    thumbnail: null,
    status: CourseStatus.PUBLISHED,
    learningOrder: CourseLearningOrder.FREE,
    rejectReason: null,
    instructorId: '55555555-5555-4555-8555-555555555555',
    instructor: undefined as never,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt,
    ...overrides,
  });

  const makeEnrollment = (overrides: Partial<Enrollment> = {}): Enrollment => ({
    id: enrollmentId,
    learnerId,
    learner: undefined as never,
    courseId,
    course: makeCourse(),
    progress: '0.00',
    enrolledAt,
    completedAt: null,
    updatedAt,
    ...overrides,
  });

  const makeLesson = (overrides: Partial<Lesson> = {}): Lesson => ({
    id: '66666666-6666-4666-8666-666666666666',
    title: 'Bai 1',
    description: 'Noi dung bai hoc',
    videoUrl: 'http://localhost:9000/bucket/video.mp4',
    materialUrl: 'http://localhost:9000/bucket/material.pdf',
    duration: 300,
    position: 0,
    courseId,
    course: makeCourse(),
    createdAt: new Date('2026-08-10T00:00:00.000Z'),
    updatedAt,
    ...overrides,
  });

  beforeEach(() => {
    coursesRepository = { findOne: jest.fn() };
    lessonsRepository = { find: jest.fn(), findOne: jest.fn() };
    enrollmentsRepository = { findOne: jest.fn() };
    service = new LearningService(
      coursesRepository as unknown as Repository<Course>,
      lessonsRepository as unknown as Repository<Lesson>,
      enrollmentsRepository as unknown as Repository<Enrollment>,
      new LearningAccessService(),
    );
  });

  describe('getCourseLearning', () => {
    it('returns an enrolled learner snapshot for a published free-order course', async () => {
      const course = makeCourse({ learningOrder: CourseLearningOrder.FREE });
      const lesson0 = makeLesson({ id: 'lesson-0', position: 0 });
      const lesson1 = makeLesson({ id: 'lesson-1', position: 1 });
      coursesRepository.findOne.mockResolvedValue(course);
      enrollmentsRepository.findOne.mockResolvedValue(makeEnrollment());
      lessonsRepository.find.mockResolvedValue([lesson0, lesson1]);

      const result = await service.getCourseLearning(learnerId, courseId);

      expect(coursesRepository.findOne).toHaveBeenCalledWith({
        where: { id: courseId },
      });
      expect(enrollmentsRepository.findOne).toHaveBeenCalledWith({
        where: { learnerId, courseId },
      });
      expect(lessonsRepository.find).toHaveBeenCalledWith({
        where: { courseId },
        order: { position: 'ASC', createdAt: 'ASC' },
      });
      expect(result.course).toEqual({
        id: courseId,
        title: course.title,
        description: course.description,
        thumbnail: course.thumbnail,
        learningOrder: CourseLearningOrder.FREE,
      });
      expect(result.enrollment).toEqual({
        id: enrollmentId,
        progress: '0.00',
        enrolledAt,
        completedAt: null,
      });
      expect(result.lessons).toEqual([
        expect.objectContaining({ id: 'lesson-0', isAccessible: true }),
        expect.objectContaining({ id: 'lesson-1', isAccessible: true }),
      ]);
      expect(result.firstAccessibleLessonId).toBe('lesson-0');
    });

    it('rejects a learner who is not enrolled', async () => {
      coursesRepository.findOne.mockResolvedValue(makeCourse());
      enrollmentsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getCourseLearning(learnerId, courseId),
      ).rejects.toEqual(
        new ForbiddenException('Bạn cần đăng ký khóa học để học nội dung này'),
      );
      expect(lessonsRepository.find).not.toHaveBeenCalled();
    });

    it.each([CourseStatus.DRAFT, CourseStatus.PENDING, CourseStatus.REJECTED])(
      'does not expose %s courses',
      async (status) => {
        coursesRepository.findOne.mockResolvedValue(makeCourse({ status }));

        await expect(
          service.getCourseLearning(learnerId, courseId),
        ).rejects.toEqual(new NotFoundException('Course not found'));
      },
    );

    it('marks only the first lesson accessible in sequential mode for T1-10', async () => {
      coursesRepository.findOne.mockResolvedValue(
        makeCourse({ learningOrder: CourseLearningOrder.SEQUENTIAL }),
      );
      enrollmentsRepository.findOne.mockResolvedValue(makeEnrollment());
      lessonsRepository.find.mockResolvedValue([
        makeLesson({ id: 'lesson-0', position: 0 }),
        makeLesson({ id: 'lesson-1', position: 1 }),
      ]);

      const result = await service.getCourseLearning(learnerId, courseId);

      expect(result.lessons).toEqual([
        expect.objectContaining({
          id: 'lesson-0',
          isAccessible: true,
          blockedReason: null,
          isCompleted: false,
        }),
        expect.objectContaining({
          id: 'lesson-1',
          isAccessible: false,
          blockedReason: SEQUENTIAL_BLOCK_MESSAGE,
          isCompleted: false,
        }),
      ]);
      expect(result.firstAccessibleLessonId).toBe('lesson-0');
    });
  });

  describe('getLessonLearning', () => {
    it('returns playable data for an accessible lesson', async () => {
      const lesson = makeLesson({ id: 'lesson-0', position: 0 });
      coursesRepository.findOne.mockResolvedValue(
        makeCourse({ learningOrder: CourseLearningOrder.SEQUENTIAL }),
      );
      enrollmentsRepository.findOne.mockResolvedValue(makeEnrollment());
      lessonsRepository.find.mockResolvedValue([lesson]);
      lessonsRepository.findOne.mockResolvedValue(lesson);

      const result = await service.getLessonLearning(
        learnerId,
        courseId,
        'lesson-0',
      );

      expect(lessonsRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'lesson-0', courseId },
      });
      expect(result).toEqual(
        expect.objectContaining({
          id: 'lesson-0',
          courseId,
          videoUrl: lesson.videoUrl,
          materialUrl: lesson.materialUrl,
          isAccessible: true,
        }),
      );
    });

    it('blocks direct playback for an inaccessible sequential lesson', async () => {
      const lesson0 = makeLesson({ id: 'lesson-0', position: 0 });
      const lesson1 = makeLesson({ id: 'lesson-1', position: 1 });
      coursesRepository.findOne.mockResolvedValue(
        makeCourse({ learningOrder: CourseLearningOrder.SEQUENTIAL }),
      );
      enrollmentsRepository.findOne.mockResolvedValue(makeEnrollment());
      lessonsRepository.find.mockResolvedValue([lesson0, lesson1]);
      lessonsRepository.findOne.mockResolvedValue(lesson1);

      await expect(
        service.getLessonLearning(learnerId, courseId, 'lesson-1'),
      ).rejects.toEqual(new ForbiddenException(SEQUENTIAL_BLOCK_MESSAGE));
    });

    it('throws not found when the lesson is not in the course', async () => {
      coursesRepository.findOne.mockResolvedValue(makeCourse());
      enrollmentsRepository.findOne.mockResolvedValue(makeEnrollment());
      lessonsRepository.find.mockResolvedValue([
        makeLesson({ id: 'lesson-0', courseId }),
      ]);
      lessonsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getLessonLearning(learnerId, courseId, 'missing-lesson'),
      ).rejects.toEqual(new NotFoundException('Lesson not found'));
    });

    it('throws not found when a lesson belongs to another course', async () => {
      coursesRepository.findOne.mockResolvedValue(makeCourse());
      enrollmentsRepository.findOne.mockResolvedValue(makeEnrollment());
      lessonsRepository.find.mockResolvedValue([
        makeLesson({ id: 'lesson-0', courseId }),
      ]);
      lessonsRepository.findOne.mockResolvedValue(
        makeLesson({ id: 'other-lesson', courseId: otherCourseId }),
      );

      await expect(
        service.getLessonLearning(learnerId, courseId, 'other-lesson'),
      ).rejects.toEqual(new NotFoundException('Lesson not found'));
    });
  });
});
