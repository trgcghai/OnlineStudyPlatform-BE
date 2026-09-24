import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Course, CourseStatus } from '../courses/entities/course.entity';
import { LearningProgressService } from '../learning/learning-progress.service';
import { Lesson } from '../lessons/entities/lesson.entity';
import { NotificationsQueueService } from '../notifications/notifications-queue.service';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { EssayGradingStatusFilter } from './dto/essay-grading.dto';
import {
  QuizAttemptQuestionResult,
  QuizAttemptStatus,
} from './dto/quiz-attempt.dto';
import { Question, QuestionType } from './entities/question.entity';
import { QuizAttempt } from './entities/quiz-attempt.entity';
import { Quiz } from './entities/quiz.entity';
import { EssayGradingService } from './essay-grading.service';

const instructorId = '11111111-1111-4111-8111-111111111111';
const learnerId = '22222222-2222-4222-8222-222222222222';
const courseId = '33333333-3333-4333-8333-333333333333';
const lessonId = '44444444-4444-4444-8444-444444444444';
const quizId = '55555555-5555-4555-8555-555555555555';
const attemptId = '66666666-6666-4666-8666-666666666666';
const mcqQuestionId = '77777777-7777-4777-8777-777777777777';
const essayQuestionId = '88888888-8888-4888-8888-888888888888';
const now = new Date('2026-09-02T10:00:00.000Z');

function mockRepository() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value) => value),
    save: jest.fn((value) => value),
  };
}

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: courseId,
    title: 'Course',
    description: 'Description',
    category: 'Backend',
    thumbnail: null,
    status: CourseStatus.PUBLISHED,
    learningOrder: 'free' as Course['learningOrder'],
    completionThresholdPercent: '90.00',
    rejectReason: null,
    instructorId,
    instructor: undefined as never,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: lessonId,
    title: 'Lesson',
    description: 'Description',
    videoUrl: null,
    materialUrl: null,
    duration: 600,
    position: 0,
    courseId,
    course: makeCourse(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: mcqQuestionId,
    quizId,
    quiz: undefined as never,
    type: QuestionType.MCQ,
    content: 'Choose one',
    options: ['A', 'B'],
    correctAnswers: [0],
    points: 10,
    position: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeEssayQuestion(overrides: Partial<Question> = {}): Question {
  return makeQuestion({
    id: essayQuestionId,
    type: QuestionType.ESSAY,
    content: 'Explain',
    options: [],
    correctAnswers: [],
    points: 10,
    position: 1,
    ...overrides,
  });
}

function makeQuiz(overrides: Partial<Quiz> = {}): Quiz {
  return {
    id: quizId,
    lessonId,
    lesson: makeLesson(),
    title: 'Quiz',
    description: 'Quiz description',
    timeLimitMinutes: 30,
    passScore: 70,
    questions: [makeQuestion(), makeEssayQuestion()],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeLearner(overrides: Partial<User> = {}): User {
  return {
    id: learnerId,
    name: 'Learner',
    email: 'learner@example.com',
    password: 'hashed',
    role: UserRole.LEARNER,
    avatar: null,
    status: UserStatus.ACTIVE,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makePendingEssayResult(
  overrides: Partial<QuizAttemptQuestionResult> = {},
): QuizAttemptQuestionResult {
  return {
    questionId: essayQuestionId,
    type: QuestionType.ESSAY,
    text: 'My answer',
    score: 0,
    maxScore: 10,
    isCorrect: false,
    status: 'pending_grading',
    ...overrides,
  };
}

function makeMcqResult(
  overrides: Partial<QuizAttemptQuestionResult> = {},
): QuizAttemptQuestionResult {
  return {
    questionId: mcqQuestionId,
    type: QuestionType.MCQ,
    selectedOptionIndexes: [0],
    score: 10,
    maxScore: 10,
    isCorrect: true,
    status: 'correct',
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<QuizAttempt> = {}): QuizAttempt {
  return {
    id: attemptId,
    quizId,
    quiz: makeQuiz(),
    learnerId,
    status: QuizAttemptStatus.NOT_PASSED,
    score: '10.00',
    totalPoints: '20.00',
    passScore: 70,
    passScorePoints: 14,
    passed: false,
    answers: [],
    gradingResult: [makeMcqResult(), makePendingEssayResult()],
    correctCount: 1,
    wrongCount: 0,
    pendingEssayCount: 1,
    startedAt: now,
    submittedAt: now,
    timeLimitMinutes: 30,
    expiresAt: new Date('2026-09-04T10:30:00.000Z'),
    isLate: false,
    lateSeconds: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('EssayGradingService', () => {
  let service: EssayGradingService;
  let coursesRepository: ReturnType<typeof mockRepository>;
  let quizzesRepository: ReturnType<typeof mockRepository>;
  let attemptsRepository: ReturnType<typeof mockRepository>;
  let usersRepository: ReturnType<typeof mockRepository>;
  let learningProgressService: {
    recomputeLessonAndEnrollmentProgress: jest.Mock;
  };
  let notificationsQueueService: {
    enqueueCreateNotification: jest.Mock;
  };
  let queryRunner: {
    manager: {
      findOne: jest.Mock;
      save: jest.Mock;
    };
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    coursesRepository = mockRepository();
    quizzesRepository = mockRepository();
    attemptsRepository = mockRepository();
    usersRepository = mockRepository();
    learningProgressService = {
      recomputeLessonAndEnrollmentProgress: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    notificationsQueueService = {
      enqueueCreateNotification: jest.fn(),
    };
    queryRunner = {
      manager: {
        findOne: jest.fn().mockResolvedValue(makeAttempt()),
        save: jest.fn((_entity, value) => value),
      },
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };

    service = new EssayGradingService(
      coursesRepository as unknown as Repository<Course>,
      quizzesRepository as unknown as Repository<Quiz>,
      attemptsRepository as unknown as Repository<QuizAttempt>,
      usersRepository as unknown as Repository<User>,
      learningProgressService as unknown as LearningProgressService,
      {
        createQueryRunner: jest.fn().mockReturnValue(queryRunner),
      } as unknown as DataSource,
      notificationsQueueService as unknown as NotificationsQueueService,
    );
    coursesRepository.findOne.mockResolvedValue(makeCourse());
    quizzesRepository.findOne.mockResolvedValue(makeQuiz());
    usersRepository.find.mockResolvedValue([makeLearner()]);
  });

  afterEach(() => jest.useRealTimers());

  it('lists pending essay submissions with learner details', async () => {
    attemptsRepository.find.mockResolvedValue([makeAttempt()]);

    const result = await service.listSubmissions(
      instructorId,
      courseId,
      quizId,
      {
        status: EssayGradingStatusFilter.PENDING,
      },
    );

    expect(result).toEqual({
      items: [
        expect.objectContaining({
          attemptId,
          learner: {
            id: learnerId,
            name: 'Learner',
            email: 'learner@example.com',
          },
          pendingEssayCount: 1,
          essays: [
            expect.objectContaining({
              questionId: essayQuestionId,
              content: 'Explain',
              status: 'pending_grading',
            }),
          ],
        }),
      ],
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
    });
  });

  it('filters graded essay submissions', async () => {
    attemptsRepository.find.mockResolvedValue([
      makeAttempt(),
      makeAttempt({
        id: '99999999-9999-4999-8999-999999999999',
        pendingEssayCount: 0,
        gradingResult: [
          makeMcqResult(),
          makePendingEssayResult({
            status: 'partial',
            score: 5,
            feedback: 'Ok',
          }),
        ],
      }),
    ]);

    const result = await service.listSubmissions(
      instructorId,
      courseId,
      quizId,
      {
        status: EssayGradingStatusFilter.GRADED,
      },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].attemptId).toBe(
      '99999999-9999-4999-8999-999999999999',
    );
  });

  it('paginates filtered essay submissions', async () => {
    attemptsRepository.find.mockResolvedValue([
      makeAttempt({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      makeAttempt({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
      makeAttempt({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }),
    ]);

    const result = await service.listSubmissions(
      instructorId,
      courseId,
      quizId,
      {
        status: EssayGradingStatusFilter.PENDING,
        page: 2,
        limit: 2,
      },
    );

    expect(result.items.map((item) => item.attemptId)).toEqual([
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    ]);
    expect(result).toMatchObject({
      total: 3,
      page: 2,
      limit: 2,
      totalPages: 2,
    });
  });

  it('rejects queue access for non-owner instructors', async () => {
    coursesRepository.findOne.mockResolvedValue(
      makeCourse({ instructorId: '99999999-9999-4999-8999-999999999999' }),
    );

    await expect(
      service.listSubmissions(instructorId, courseId, quizId, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects grading points above the essay max score', async () => {
    await expect(
      service.gradeEssay(
        instructorId,
        courseId,
        quizId,
        attemptId,
        essayQuestionId,
        {
          points: 11,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects grading a non-essay question', async () => {
    await expect(
      service.gradeEssay(
        instructorId,
        courseId,
        quizId,
        attemptId,
        mcqQuestionId,
        {
          points: 10,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects missing attempts', async () => {
    queryRunner.manager.findOne.mockResolvedValue(null);

    await expect(
      service.gradeEssay(
        instructorId,
        courseId,
        quizId,
        attemptId,
        essayQuestionId,
        {
          points: 8,
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects in-progress attempts', async () => {
    queryRunner.manager.findOne.mockResolvedValue(
      makeAttempt({ submittedAt: null, status: QuizAttemptStatus.IN_PROGRESS }),
    );

    await expect(
      service.gradeEssay(
        instructorId,
        courseId,
        quizId,
        attemptId,
        essayQuestionId,
        {
          points: 8,
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('persists essay grade and recomputes the attempt', async () => {
    const result = await service.gradeEssay(
      instructorId,
      courseId,
      quizId,
      attemptId,
      essayQuestionId,
      { points: 4, feedback: 'Needs more detail' },
    );

    expect(queryRunner.manager.save).toHaveBeenCalledWith(
      QuizAttempt,
      expect.objectContaining({
        score: '14.00',
        pendingEssayCount: 0,
        passed: true,
        status: QuizAttemptStatus.PASSED,
      }),
    );
    expect(result.totalScore).toBe(14);
    expect(result.passed).toBe(true);
    expect(result.questions[1]).toMatchObject({
      questionId: essayQuestionId,
      score: 4,
      feedback: 'Needs more detail',
      gradedAt: now.toISOString(),
      gradedBy: instructorId,
      status: 'partial',
    });
    expect(
      learningProgressService.recomputeLessonAndEnrollmentProgress,
    ).toHaveBeenCalledWith(learnerId, courseId, lessonId);
  });

  it('enqueues learner notification when grading completes all pending essays', async () => {
    await service.gradeEssay(
      instructorId,
      courseId,
      quizId,
      attemptId,
      essayQuestionId,
      {
        points: 10,
        feedback: 'Good answer',
      },
    );

    expect(
      notificationsQueueService.enqueueCreateNotification,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'direct',
        targetUserId: learnerId,
        actionUrl: `/learner/courses/${courseId}/learn`,
        triggerKey: `essay-graded:${attemptId}`,
        triggerDate: '2026-09-02',
        metadata: expect.objectContaining({
          attemptId,
          quizId,
          courseId,
          lessonId,
          learnerId,
          instructorId,
          pendingEssayCount: 0,
        }),
      }),
    );
  });

  it('does not enqueue learner notification while other essays remain pending', async () => {
    const secondEssayQuestionId = '99999999-9999-4999-8999-999999999999';
    quizzesRepository.findOne.mockResolvedValue(
      makeQuiz({
        questions: [
          makeQuestion(),
          makeEssayQuestion(),
          makeEssayQuestion({ id: secondEssayQuestionId, position: 2 }),
        ],
      }),
    );
    queryRunner.manager.findOne.mockResolvedValue(
      makeAttempt({
        pendingEssayCount: 2,
        gradingResult: [
          makeMcqResult(),
          makePendingEssayResult(),
          makePendingEssayResult({ questionId: secondEssayQuestionId }),
        ],
      }),
    );

    await service.gradeEssay(
      instructorId,
      courseId,
      quizId,
      attemptId,
      essayQuestionId,
      { points: 10 },
    );

    expect(
      notificationsQueueService.enqueueCreateNotification,
    ).not.toHaveBeenCalled();
  });

  it('keeps essay grading successful when notification enqueue fails', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();
    notificationsQueueService.enqueueCreateNotification.mockImplementationOnce(
      () => {
        throw new Error('queue unavailable');
      },
    );

    await expect(
      service.gradeEssay(
        instructorId,
        courseId,
        quizId,
        attemptId,
        essayQuestionId,
        { points: 10 },
      ),
    ).resolves.toMatchObject({ attemptId, pendingEssayCount: 0 });

    loggerSpy.mockRestore();
  });

  it('does not recompute progress when grading does not pass the attempt', async () => {
    const result = await service.gradeEssay(
      instructorId,
      courseId,
      quizId,
      attemptId,
      essayQuestionId,
      { points: 3 },
    );

    expect(result.passed).toBe(false);
    expect(
      learningProgressService.recomputeLessonAndEnrollmentProgress,
    ).not.toHaveBeenCalled();
  });

  it('recomputes progress when regrading flips a passed attempt to not passed', async () => {
    queryRunner.manager.findOne.mockResolvedValue(
      makeAttempt({
        passed: true,
        status: QuizAttemptStatus.PASSED,
        score: '20.00',
        pendingEssayCount: 0,
        gradingResult: [
          makeMcqResult(),
          makePendingEssayResult({
            status: 'correct',
            score: 10,
            isCorrect: true,
            feedback: 'Excellent',
          }),
        ],
      }),
    );

    const result = await service.gradeEssay(
      instructorId,
      courseId,
      quizId,
      attemptId,
      essayQuestionId,
      { points: 3 },
    );

    expect(result.passed).toBe(false);
    expect(
      learningProgressService.recomputeLessonAndEnrollmentProgress,
    ).toHaveBeenCalledWith(learnerId, courseId, lessonId);
  });

  it('does not roll back a committed grade when progress recompute fails', async () => {
    learningProgressService.recomputeLessonAndEnrollmentProgress.mockRejectedValue(
      new Error('progress failed'),
    );

    await expect(
      service.gradeEssay(
        instructorId,
        courseId,
        quizId,
        attemptId,
        essayQuestionId,
        { points: 4 },
      ),
    ).rejects.toThrow('progress failed');

    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
  });
});
