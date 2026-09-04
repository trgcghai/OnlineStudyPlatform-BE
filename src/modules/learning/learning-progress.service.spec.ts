import { ForbiddenException } from '@nestjs/common';
import { IsNull, Not, Repository } from 'typeorm';
import {
  Course,
  CourseLearningOrder,
  CourseStatus,
} from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { LearningAccessService } from '../lessons/learning-access.service';
import { QuizAttemptStatus } from '../quizzes/dto/quiz-attempt.dto';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { Quiz } from '../quizzes/entities/quiz.entity';
import { LearningAnalyticsEvent } from './entities/learning-analytics-event.entity';
import { LessonProgress } from './entities/lesson-progress.entity';
import {
  LessonWatchEvent,
  LessonWatchEventType,
} from './entities/lesson-watch-event.entity';
import { CourseProgressService } from './course-progress.service';
import { LearningProgressService } from './learning-progress.service';

describe('LearningProgressService', () => {
  let service: LearningProgressService;
  let coursesRepository: { findOne: jest.Mock };
  let lessonsRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    count: jest.Mock;
  };
  let enrollmentsRepository: { findOne: jest.Mock; save: jest.Mock };
  let quizzesRepository: { findOne: jest.Mock };
  let quizAttemptsRepository: { count: jest.Mock };
  let progressRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
  };
  let watchEventsRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let analyticsEventsRepository: { create: jest.Mock; save: jest.Mock };
  let courseProgressService: {
    refreshLessonCompletion: jest.Mock;
    recomputeEnrollmentProgress: jest.Mock;
  };

  const learnerId = '11111111-1111-4111-8111-111111111111';
  const courseId = '22222222-2222-4222-8222-222222222222';
  const lessonId = '33333333-3333-4333-8333-333333333333';
  const enrollmentId = '44444444-4444-4444-8444-444444444444';
  const now = new Date('2026-08-29T00:00:00.000Z');

  const makeCourse = (overrides: Partial<Course> = {}): Course => ({
    id: courseId,
    title: 'NestJS',
    description: 'Backend course',
    category: 'Backend',
    thumbnail: null,
    status: CourseStatus.PUBLISHED,
    learningOrder: CourseLearningOrder.FREE,
    completionThresholdPercent: '90.00',
    rejectReason: null,
    instructorId: '55555555-5555-4555-8555-555555555555',
    instructor: undefined as never,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  const makeLesson = (overrides: Partial<Lesson> = {}): Lesson => ({
    id: lessonId,
    title: 'Lesson 1',
    description: 'Intro',
    videoUrl: null,
    materialUrl: null,
    duration: 600,
    position: 0,
    courseId,
    course: makeCourse(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  const makeEnrollment = (overrides: Partial<Enrollment> = {}): Enrollment => ({
    id: enrollmentId,
    learnerId,
    learner: undefined as never,
    courseId,
    course: makeCourse(),
    progress: '0.00',
    enrolledAt: now,
    completedAt: null,
    updatedAt: now,
    ...overrides,
  });

  const dto = {
    idempotencyKey: 'course:lesson:session:heartbeat:540',
    eventType: LessonWatchEventType.HEARTBEAT,
    positionSeconds: 540,
    watchedSeconds: 540,
    durationSeconds: 600,
    clientCreatedAt: '2026-08-29T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    coursesRepository = { findOne: jest.fn() };
    lessonsRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
    };
    enrollmentsRepository = { findOne: jest.fn(), save: jest.fn() };
    quizzesRepository = { findOne: jest.fn() };
    quizAttemptsRepository = { count: jest.fn() };
    progressRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn((value) => value),
      count: jest.fn(),
    };
    watchEventsRepository = {
      findOne: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn((value) => value),
    };
    analyticsEventsRepository = {
      create: jest.fn((value) => value),
      save: jest.fn((value) => value),
    };
    courseProgressService = {
      refreshLessonCompletion: jest.fn(),
      recomputeEnrollmentProgress: jest.fn(() =>
        Promise.resolve(makeEnrollment({ progress: '50.00' })),
      ),
    };

    service = new LearningProgressService(
      coursesRepository as unknown as Repository<Course>,
      lessonsRepository as unknown as Repository<Lesson>,
      enrollmentsRepository as unknown as Repository<Enrollment>,
      quizzesRepository as unknown as Repository<Quiz>,
      quizAttemptsRepository as unknown as Repository<QuizAttempt>,
      progressRepository as unknown as Repository<LessonProgress>,
      watchEventsRepository as unknown as Repository<LessonWatchEvent>,
      analyticsEventsRepository as unknown as Repository<LearningAnalyticsEvent>,
      new LearningAccessService(),
      courseProgressService as unknown as CourseProgressService,
    );
  });

  afterEach(() => jest.useRealTimers());

  function arrangeValidContext() {
    coursesRepository.findOne.mockResolvedValue(makeCourse());
    enrollmentsRepository.findOne.mockResolvedValue(makeEnrollment());
    const lesson = makeLesson();
    lessonsRepository.findOne.mockResolvedValue(lesson);
    lessonsRepository.find.mockResolvedValue([lesson]);
    lessonsRepository.count.mockResolvedValue(2);
    quizzesRepository.findOne.mockResolvedValue(null);
    quizAttemptsRepository.count.mockResolvedValue(0);
    progressRepository.find.mockResolvedValue([]);
    progressRepository.findOne.mockResolvedValue(null);
    watchEventsRepository.findOne.mockResolvedValue(null);
    progressRepository.count.mockResolvedValue(1);
    enrollmentsRepository.save.mockImplementation((value) => value);
  }

  it('records a valid watch event and completes the lesson at the threshold', async () => {
    arrangeValidContext();

    const result = await service.recordWatchEvent(
      learnerId,
      courseId,
      lessonId,
      dto,
    );

    expect(watchEventsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: dto.idempotencyKey }),
    );
    expect(progressRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        learnerId,
        courseId,
        lessonId,
        watchedSeconds: 540,
        lastPositionSeconds: 540,
        watchRatio: '0.9000',
        watchCompletedAt: now,
        lessonCompletedAt: now,
      }),
    );
    expect(
      courseProgressService.recomputeEnrollmentProgress,
    ).toHaveBeenCalledWith(learnerId, courseId);
    expect(analyticsEventsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        learnerId,
        courseId,
        lessonId,
        eventType: LessonWatchEventType.HEARTBEAT,
      }),
    );
    expect(result.lessonProgress.isWatchComplete).toBe(true);
    expect(result.lessonProgress.isLessonComplete).toBe(true);
    expect(result.enrollment.progress).toBe('50.00');
  });

  it('returns current progress without applying duplicate idempotency keys', async () => {
    arrangeValidContext();
    watchEventsRepository.findOne.mockResolvedValue({
      idempotencyKey: dto.idempotencyKey,
    });
    progressRepository.findOne.mockResolvedValue({
      lessonId,
      watchedSeconds: 120,
      lastPositionSeconds: 120,
      watchRatio: '0.2000',
      watchCompletedAt: null,
      lessonCompletedAt: null,
    });

    const result = await service.recordWatchEvent(
      learnerId,
      courseId,
      lessonId,
      dto,
    );

    expect(watchEventsRepository.save).not.toHaveBeenCalled();
    expect(progressRepository.save).not.toHaveBeenCalled();
    expect(analyticsEventsRepository.save).not.toHaveBeenCalled();
    expect(result.lessonProgress.watchedSeconds).toBe(120);
  });

  it('does not complete when watch ratio is below threshold', async () => {
    arrangeValidContext();

    const result = await service.recordWatchEvent(
      learnerId,
      courseId,
      lessonId,
      {
        ...dto,
        idempotencyKey: 'below-threshold',
        watchedSeconds: 300,
        positionSeconds: 300,
      },
    );

    expect(result.lessonProgress.isLessonComplete).toBe(false);
    expect(
      courseProgressService.recomputeEnrollmentProgress,
    ).not.toHaveBeenCalled();
  });

  it('does not complete a lesson with a quiz from watch completion alone', async () => {
    arrangeValidContext();
    quizzesRepository.findOne.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      lessonId,
    });
    quizAttemptsRepository.count.mockResolvedValue(0);

    const result = await service.recordWatchEvent(
      learnerId,
      courseId,
      lessonId,
      dto,
    );

    expect(result.lessonProgress.isWatchComplete).toBe(true);
    expect(result.lessonProgress.isLessonComplete).toBe(false);
    expect(quizAttemptsRepository.count).toHaveBeenCalledWith({
      where: {
        learnerId,
        quizId: '55555555-5555-4555-8555-555555555555',
        passed: true,
        status: QuizAttemptStatus.PASSED,
        submittedAt: Not(IsNull()),
      },
    });
  });

  it('completes a lesson when watch threshold is met and a passed quiz attempt exists', async () => {
    arrangeValidContext();
    quizzesRepository.findOne.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      lessonId,
    });
    quizAttemptsRepository.count.mockResolvedValue(1);

    const result = await service.recordWatchEvent(
      learnerId,
      courseId,
      lessonId,
      dto,
    );

    expect(result.lessonProgress.isLessonComplete).toBe(true);
    expect(
      courseProgressService.recomputeEnrollmentProgress,
    ).toHaveBeenCalledWith(learnerId, courseId);
  });

  it('refreshes lesson completion before recomputing enrollment progress after quiz pass', async () => {
    arrangeValidContext();
    courseProgressService.refreshLessonCompletion.mockResolvedValue({
      lessonId,
      lessonCompletedAt: new Date('2026-09-02T00:00:00.000Z'),
    });

    await service.recomputeLessonAndEnrollmentProgress(
      learnerId,
      courseId,
      lessonId,
    );

    expect(courseProgressService.refreshLessonCompletion).toHaveBeenCalledWith(
      learnerId,
      lessonId,
    );
    expect(
      courseProgressService.recomputeEnrollmentProgress,
    ).toHaveBeenCalledWith(learnerId, courseId);
  });

  it('rejects non-enrolled learners', async () => {
    coursesRepository.findOne.mockResolvedValue(makeCourse());
    enrollmentsRepository.findOne.mockResolvedValue(null);

    await expect(
      service.recordWatchEvent(learnerId, courseId, lessonId, dto),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not auto-complete a zero-duration lesson', async () => {
    arrangeValidContext();
    lessonsRepository.findOne.mockResolvedValue(makeLesson({ duration: 0 }));
    lessonsRepository.find.mockResolvedValue([makeLesson({ duration: 0 })]);

    const result = await service.recordWatchEvent(
      learnerId,
      courseId,
      lessonId,
      dto,
    );

    expect(result.lessonProgress.isLessonComplete).toBe(false);
    expect(enrollmentsRepository.save).not.toHaveBeenCalled();
  });
});
