import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, Not } from 'typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { QuizAttemptStatus } from '../quizzes/dto/quiz-attempt.dto';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { Quiz } from '../quizzes/entities/quiz.entity';
import { CourseProgressService } from './course-progress.service';
import { CertificateQueueService } from '../certificates/certificate-queue.service';
import { LessonProgress } from './entities/lesson-progress.entity';

const learnerId = '11111111-1111-4111-8111-111111111111';
const courseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const lessonId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const quizId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function mockRepository() {
  return {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn((entity) => Promise.resolve(entity)),
  };
}

function makeEnrollment(overrides: Partial<Enrollment> = {}): Enrollment {
  return {
    id: 'enrollment-id',
    learnerId,
    learner: undefined as never,
    courseId,
    course: undefined as never,
    enrolledAt: new Date('2026-09-01T00:00:00.000Z'),
    completedAt: null,
    progress: '0.00',
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeLessonProgress(
  overrides: Partial<LessonProgress> = {},
): LessonProgress {
  return {
    id: 'progress-id',
    learnerId,
    learner: undefined as never,
    courseId,
    course: undefined as never,
    lessonId,
    lesson: undefined as never,
    enrollmentId: 'enrollment-id',
    enrollment: undefined as never,
    watchedSeconds: 540,
    lastPositionSeconds: 540,
    watchRatio: '0.9000',
    watchCompletedAt: null,
    lessonCompletedAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeQuiz(overrides: Partial<Quiz> = {}): Quiz {
  return {
    id: quizId,
    lessonId,
    lesson: undefined as never,
    title: 'Quiz',
    description: '',
    timeLimitMinutes: null,
    passScore: 70,
    questions: [],
    attempts: [],
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('CourseProgressService', () => {
  let service: CourseProgressService;
  let enrollmentsRepository: ReturnType<typeof mockRepository>;
  let lessonsRepository: ReturnType<typeof mockRepository>;
  let progressRepository: ReturnType<typeof mockRepository>;
  let quizzesRepository: ReturnType<typeof mockRepository>;
  let quizAttemptsRepository: ReturnType<typeof mockRepository>;
  const certificateQueue = { enqueueCompletion: jest.fn() };

  beforeEach(async () => {
    certificateQueue.enqueueCompletion.mockReset();
    enrollmentsRepository = mockRepository();
    lessonsRepository = mockRepository();
    progressRepository = mockRepository();
    quizzesRepository = mockRepository();
    quizAttemptsRepository = mockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseProgressService,
        { provide: CertificateQueueService, useValue: certificateQueue },
        {
          provide: getRepositoryToken(Enrollment),
          useValue: enrollmentsRepository,
        },
        { provide: getRepositoryToken(Lesson), useValue: lessonsRepository },
        {
          provide: getRepositoryToken(LessonProgress),
          useValue: progressRepository,
        },
        { provide: getRepositoryToken(Quiz), useValue: quizzesRepository },
        {
          provide: getRepositoryToken(QuizAttempt),
          useValue: quizAttemptsRepository,
        },
      ],
    }).compile();

    service = module.get(CourseProgressService);
  });

  it('recomputes enrollment progress from completed lessons', async () => {
    lessonsRepository.count.mockResolvedValue(4);
    progressRepository.count.mockResolvedValue(3);
    enrollmentsRepository.findOne.mockResolvedValue(
      makeEnrollment({ progress: '0.00', completedAt: null }),
    );

    const result = await service.recomputeEnrollmentProgress(
      learnerId,
      courseId,
    );

    expect(lessonsRepository.count).toHaveBeenCalledWith({
      where: { courseId },
    });
    expect(progressRepository.count).toHaveBeenCalledWith({
      where: { learnerId, courseId, lessonCompletedAt: Not(IsNull()) },
    });
    expect(result.progress).toBe('75.00');
    expect(certificateQueue.enqueueCompletion).not.toHaveBeenCalled();
    expect(result.completedAt).toBeNull();
    expect(enrollmentsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ progress: '75.00', completedAt: null }),
    );
  });

  it('sets completedAt at 100 percent and clears it below 100 percent', async () => {
    const previousCompletedAt = new Date('2026-09-01T00:00:00.000Z');
    const enrollment = makeEnrollment({
      progress: '100.00',
      completedAt: previousCompletedAt,
    });

    lessonsRepository.count.mockResolvedValueOnce(2).mockResolvedValueOnce(2);
    progressRepository.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    enrollmentsRepository.findOne.mockResolvedValue(enrollment);

    const completed = await service.recomputeEnrollmentProgress(
      learnerId,
      courseId,
    );
    expect(completed.progress).toBe('100.00');
    expect(completed.completedAt).toBe(previousCompletedAt);
    expect(certificateQueue.enqueueCompletion).toHaveBeenCalledWith(
      learnerId,
      courseId,
    );

    const downgraded = await service.recomputeEnrollmentProgress(
      learnerId,
      courseId,
    );
    expect(downgraded.progress).toBe('50.00');
    expect(downgraded.completedAt).toBeNull();
    expect(certificateQueue.enqueueCompletion).toHaveBeenCalledTimes(1);
  });

  it('throws when recomputing a missing enrollment', async () => {
    enrollmentsRepository.findOne.mockResolvedValue(null);

    await expect(
      service.recomputeEnrollmentProgress(learnerId, courseId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sets lessonCompletedAt when watch is complete and required quiz is passed', async () => {
    const progress = makeLessonProgress({
      watchCompletedAt: new Date('2026-09-01T00:00:00.000Z'),
      lessonCompletedAt: null,
    });
    progressRepository.findOne.mockResolvedValue(progress);
    quizzesRepository.findOne.mockResolvedValue(makeQuiz());
    quizAttemptsRepository.count.mockResolvedValue(1);

    const result = await service.refreshLessonCompletion(learnerId, lessonId);

    expect(quizAttemptsRepository.count).toHaveBeenCalledWith({
      where: {
        learnerId,
        quizId,
        passed: true,
        status: QuizAttemptStatus.PASSED,
        submittedAt: Not(IsNull()),
      },
    });
    expect(result?.lessonCompletedAt).toBeInstanceOf(Date);
    expect(progressRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ lessonCompletedAt: expect.any(Date) }),
    );
  });

  it('clears lessonCompletedAt when required quiz is no longer passed', async () => {
    const progress = makeLessonProgress({
      watchCompletedAt: new Date('2026-09-01T00:00:00.000Z'),
      lessonCompletedAt: new Date('2026-09-02T00:00:00.000Z'),
    });
    progressRepository.findOne.mockResolvedValue(progress);
    quizzesRepository.findOne.mockResolvedValue(makeQuiz());
    quizAttemptsRepository.count.mockResolvedValue(0);

    const result = await service.refreshLessonCompletion(learnerId, lessonId);

    expect(result?.lessonCompletedAt).toBeNull();
    expect(progressRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ lessonCompletedAt: null }),
    );
  });

  it('preserves incomplete progress when watch threshold is not complete', async () => {
    const progress = makeLessonProgress({ watchCompletedAt: null });
    progressRepository.findOne.mockResolvedValue(progress);

    const result = await service.refreshLessonCompletion(learnerId, lessonId);

    expect(result).toBe(progress);
    expect(quizzesRepository.findOne).not.toHaveBeenCalled();
    expect(progressRepository.save).not.toHaveBeenCalled();
  });
});
