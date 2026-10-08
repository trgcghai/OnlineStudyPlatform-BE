import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataSource, EntityManager, IsNull, Not } from 'typeorm';
import { Course } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { Quiz } from '../quizzes/entities/quiz.entity';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { QuizAttemptStatus } from '../quizzes/dto/quiz-attempt.dto';
import { RedisService } from '../redis/redis.service';
import { CourseProgressService } from './course-progress.service';
import { LearningService } from './learning.service';
import { LessonCompletionService } from './lesson-completion.service';
import { LessonProgress } from './entities/lesson-progress.entity';
import { LearningAnalyticsEvent } from './entities/learning-analytics-event.entity';

describe('LessonCompletionService', () => {
  const learnerId = 'learner';
  const courseId = 'course';
  const lessonId = 'lesson';
  const now = new Date('2026-10-07T00:00:00Z');
  let service: LessonCompletionService;
  let progress: Partial<LessonProgress>;
  let enrollment: Enrollment;
  let repositories: Map<unknown, { findOne: jest.Mock; count: jest.Mock }>;
  let manager: { getRepository: jest.Mock; update: jest.Mock; save: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let learningService: { getLessonLearning: jest.Mock };
  let redisService: { invalidateNamespaces: jest.Mock };
  let courseProgressService: {
    recomputeEnrollmentProgress: jest.Mock;
    queueCertificateIfComplete: jest.Mock;
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    progress = {
      id: 'progress',
      learnerId,
      courseId,
      lessonId,
      watchedSeconds: 540,
      lastPositionSeconds: 545,
      watchRatio: '0.9000',
      watchCompletedAt: now,
      lessonCompletedAt: null,
    };
    enrollment = {
      id: 'enrollment',
      learnerId,
      courseId,
      progress: '100.00',
      enrolledAt: now,
      completedAt: now,
    } as Enrollment;
    repositories = new Map([
      [
        Course,
        {
          findOne: jest
            .fn()
            .mockResolvedValue({ completionThresholdPercent: '90.00' }),
          count: jest.fn(),
        },
      ],
      [
        Lesson,
        {
          findOne: jest
            .fn()
            .mockResolvedValue({ id: lessonId, courseId, duration: 600 }),
          count: jest.fn(),
        },
      ],
      [
        Enrollment,
        { findOne: jest.fn().mockResolvedValue(enrollment), count: jest.fn() },
      ],
      [
        LessonProgress,
        {
          findOne: jest
            .fn()
            .mockImplementation(() => Promise.resolve(progress)),
          count: jest.fn(),
        },
      ],
      [Quiz, { findOne: jest.fn().mockResolvedValue(null), count: jest.fn() }],
      [
        QuizAttempt,
        { findOne: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      ],
    ]);
    manager = {
      getRepository: jest.fn((entity: unknown) => repositories.get(entity)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn().mockResolvedValue({}),
    };
    dataSource = {
      transaction: jest.fn(
        async (work: (tx: EntityManager) => Promise<unknown>) =>
          work(manager as unknown as EntityManager),
      ),
    };
    learningService = {
      getLessonLearning: jest.fn().mockResolvedValue({ id: lessonId }),
    };
    redisService = {
      invalidateNamespaces: jest.fn().mockResolvedValue(undefined),
    };
    courseProgressService = {
      recomputeEnrollmentProgress: jest.fn().mockResolvedValue(enrollment),
      queueCertificateIfComplete: jest.fn(),
    };
    service = new LessonCompletionService(
      learningService as unknown as LearningService,
      dataSource as unknown as DataSource,
      courseProgressService as unknown as CourseProgressService,
      redisService as unknown as RedisService,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('completes from persisted viewing data and leaves watched time unchanged', async () => {
    const result = await service.completeLesson(learnerId, courseId, lessonId);
    expect(learningService.getLessonLearning).toHaveBeenCalledWith(
      learnerId,
      courseId,
      lessonId,
    );
    expect(manager.update).toHaveBeenCalledWith(LessonProgress, progress.id, {
      watchCompletedAt: now,
      lessonCompletedAt: now,
    });
    expect(result.lessonProgress).toMatchObject({
      watchedSeconds: 540,
      lastPositionSeconds: 545,
      isLessonComplete: true,
      completedAt: now,
    });
    expect(
      courseProgressService.recomputeEnrollmentProgress,
    ).toHaveBeenCalledWith(learnerId, courseId, manager);
    expect(
      courseProgressService.queueCertificateIfComplete,
    ).toHaveBeenCalledWith(enrollment);
    expect(manager.save).toHaveBeenCalledWith(
      LearningAnalyticsEvent,
      expect.objectContaining({
        eventType: 'completed',
        payload: expect.objectContaining({ source: 'manual_confirmation' }),
      }),
    );
    expect(redisService.invalidateNamespaces).toHaveBeenCalledWith([
      'learning:course',
      'learning:lesson',
      'dashboard:learner',
    ]);
  });

  it('rejects insufficient watching without changing DB or enrollment', async () => {
    progress.watchedSeconds = 539;
    await expect(
      service.completeLesson(learnerId, courseId, lessonId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
    expect(
      courseProgressService.recomputeEnrollmentProgress,
    ).not.toHaveBeenCalled();
  });

  it('does not treat a stale completion timestamp as proof of the current threshold', async () => {
    repositories
      .get(Course)!
      .findOne.mockResolvedValue({ completionThresholdPercent: '95.00' });
    await expect(
      service.completeLesson(learnerId, courseId, lessonId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it.each([null, { ...{ watchedSeconds: 0, watchRatio: '0.0000' } }])(
    'rejects missing or empty progress: %p',
    async (value) => {
      repositories.get(LessonProgress)!.findOne.mockResolvedValue(value);
      await expect(
        service.completeLesson(learnerId, courseId, lessonId),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.update).not.toHaveBeenCalled();
    },
  );

  it('rejects a video with unknown duration', async () => {
    repositories
      .get(Lesson)!
      .findOne.mockResolvedValue({ id: lessonId, courseId, duration: 0 });
    await expect(
      service.completeLesson(learnerId, courseId, lessonId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a submitted passed quiz with no pending essay answers', async () => {
    repositories.get(Quiz)!.findOne.mockResolvedValue({ id: 'quiz' });
    await expect(
      service.completeLesson(learnerId, courseId, lessonId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repositories.get(QuizAttempt)!.count).toHaveBeenCalledWith({
      where: {
        learnerId,
        quizId: 'quiz',
        passed: true,
        status: QuizAttemptStatus.PASSED,
        submittedAt: Not(IsNull()),
        pendingEssayCount: 0,
      },
    });
    expect(manager.update).not.toHaveBeenCalled();
    repositories.get(QuizAttempt)!.count.mockResolvedValue(1);
    const result = await service.completeLesson(learnerId, courseId, lessonId);
    expect(result.lessonProgress.isLessonComplete).toBe(true);
  });

  it('returns existing completion without creating a second completion event', async () => {
    progress.lessonCompletedAt = new Date('2026-10-06T00:00:00Z');
    const result = await service.completeLesson(learnerId, courseId, lessonId);
    expect(result.lessonProgress.completedAt).toBe(progress.lessonCompletedAt);
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects inaccessible or non-enrolled learners before starting a transaction', async () => {
    learningService.getLessonLearning.mockRejectedValue(
      new ForbiddenException('Bài học bị khóa'),
    );
    await expect(
      service.completeLesson(learnerId, courseId, lessonId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('does not enqueue a certificate when the transaction fails', async () => {
    courseProgressService.recomputeEnrollmentProgress.mockRejectedValue(
      new Error('DB error'),
    );
    await expect(
      service.completeLesson(learnerId, courseId, lessonId),
    ).rejects.toThrow('DB error');
    expect(
      courseProgressService.queueCertificateIfComplete,
    ).not.toHaveBeenCalled();
    expect(redisService.invalidateNamespaces).not.toHaveBeenCalled();
  });

  it('defers certificate publication until the transaction has committed', async () => {
    dataSource.transaction.mockImplementationOnce(
      async (work: (tx: EntityManager) => Promise<unknown>) => {
        const result = await work(manager as unknown as EntityManager);
        expect(
          courseProgressService.queueCertificateIfComplete,
        ).not.toHaveBeenCalled();
        expect(redisService.invalidateNamespaces).not.toHaveBeenCalled();
        return result;
      },
    );
    await service.completeLesson(learnerId, courseId, lessonId);
    expect(
      courseProgressService.queueCertificateIfComplete,
    ).toHaveBeenCalledTimes(1);
  });
});
