import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import {
  Course,
  CourseLearningOrder,
  CourseStatus,
} from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { LearningAnalyticsEvent } from '../learning/entities/learning-analytics-event.entity';
import { LearningProgressService } from '../learning/learning-progress.service';
import { Lesson } from '../lessons/entities/lesson.entity';
import { LearningAccessService } from '../lessons/learning-access.service';
import { NotificationsQueueService } from '../notifications/notifications-queue.service';
import { QuizAttemptStatus } from './dto/quiz-attempt.dto';
import { Question, QuestionType } from './entities/question.entity';
import { QuizAttempt } from './entities/quiz-attempt.entity';
import { Quiz } from './entities/quiz.entity';
import { QuizAttemptsService } from './quiz-attempts.service';

const learnerId = '11111111-1111-4111-8111-111111111111';
const courseId = '22222222-2222-4222-8222-222222222222';
const lessonId = '33333333-3333-4333-8333-333333333333';
const quizId = '44444444-4444-4444-8444-444444444444';
const attemptId = '55555555-5555-4555-8555-555555555555';
const questionId = '66666666-6666-4666-8666-666666666666';
const essayQuestionId = '77777777-7777-4777-8777-777777777777';
const now = new Date('2026-08-31T10:00:00.000Z');

function mockRepository() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value) => value),
    save: jest.fn((value) => value),
    count: jest.fn().mockResolvedValue(0),
    update: jest.fn().mockResolvedValue({ affected: 0 }),
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
    learningOrder: CourseLearningOrder.FREE,
    completionThresholdPercent: '90.00',
    rejectReason: null,
    instructorId: '88888888-8888-4888-8888-888888888888',
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

function makeEnrollment(overrides: Partial<Enrollment> = {}): Enrollment {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    learnerId,
    learner: undefined as never,
    courseId,
    course: makeCourse(),
    progress: '0.00',
    enrolledAt: now,
    completedAt: null,
    updatedAt: now,
    ...overrides,
  };
}

function makeMcqQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: questionId,
    quizId,
    quiz: undefined as never,
    type: QuestionType.MCQ,
    content: 'Choose correct answers',
    options: ['A', 'B', 'C', 'D'],
    correctAnswers: [0],
    points: 10,
    position: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeEssayQuestion(overrides: Partial<Question> = {}): Question {
  return makeMcqQuestion({
    id: essayQuestionId,
    type: QuestionType.ESSAY,
    content: 'Explain your answer',
    options: [],
    correctAnswers: [],
    points: 10,
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
    questions: [makeMcqQuestion()],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<QuizAttempt> = {}): QuizAttempt {
  return {
    id: attemptId,
    quizId,
    quiz: makeQuiz(),
    learnerId,
    status: QuizAttemptStatus.IN_PROGRESS,
    score: '0.00',
    totalPoints: '10.00',
    passScore: 70,
    passScorePoints: 7,
    passed: false,
    answers: null,
    gradingResult: null,
    correctCount: 0,
    wrongCount: 0,
    pendingEssayCount: 0,
    startedAt: now,
    submittedAt: null,
    timeLimitMinutes: 30,
    expiresAt: new Date('2026-09-02T10:30:00.000Z'),
    isLate: false,
    lateSeconds: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('QuizAttemptsService', () => {
  let service: QuizAttemptsService;
  let coursesRepository: ReturnType<typeof mockRepository>;
  let lessonsRepository: ReturnType<typeof mockRepository>;
  let enrollmentsRepository: ReturnType<typeof mockRepository>;
  let quizzesRepository: ReturnType<typeof mockRepository>;
  let attemptsRepository: ReturnType<typeof mockRepository>;
  let analyticsEventsRepository: ReturnType<typeof mockRepository>;
  let learningProgressService: {
    getCompletedLessonIds: jest.Mock;
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
    lessonsRepository = mockRepository();
    enrollmentsRepository = mockRepository();
    quizzesRepository = mockRepository();
    attemptsRepository = mockRepository();
    analyticsEventsRepository = mockRepository();
    learningProgressService = {
      getCompletedLessonIds: jest.fn().mockResolvedValue(new Set<string>()),
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

    service = new QuizAttemptsService(
      coursesRepository as unknown as Repository<Course>,
      lessonsRepository as unknown as Repository<Lesson>,
      enrollmentsRepository as unknown as Repository<Enrollment>,
      quizzesRepository as unknown as Repository<Quiz>,
      attemptsRepository as unknown as Repository<QuizAttempt>,
      analyticsEventsRepository as unknown as Repository<LearningAnalyticsEvent>,
      new LearningAccessService(),
      learningProgressService as unknown as LearningProgressService,
      {
        createQueryRunner: jest.fn().mockReturnValue(queryRunner),
      } as unknown as DataSource,
      notificationsQueueService as unknown as NotificationsQueueService,
    );
  });

  afterEach(() => jest.useRealTimers());

  function arrangeValidContext(quiz: Quiz | null = makeQuiz()) {
    coursesRepository.findOne.mockResolvedValue(makeCourse());
    enrollmentsRepository.findOne.mockResolvedValue(makeEnrollment());
    lessonsRepository.findOne.mockResolvedValue(makeLesson());
    lessonsRepository.find.mockResolvedValue([makeLesson()]);
    quizzesRepository.findOne.mockResolvedValue(quiz);
  }

  function arrangeSubmitContext(
    input: {
      quiz?: Quiz;
      attempt?: QuizAttempt;
      questions?: Question[];
    } = {},
  ) {
    const quiz =
      input.quiz ??
      makeQuiz(input.questions ? { questions: input.questions } : {});
    arrangeValidContext(quiz);
    queryRunner.manager.findOne.mockResolvedValue(
      input.attempt ?? makeAttempt(),
    );
  }

  it('loads learner-safe quiz without correct answers', async () => {
    arrangeValidContext(makeQuiz({ questions: [makeMcqQuestion()] }));

    const result = await service.loadLearnerQuiz(learnerId, courseId, lessonId);

    expect(result.quiz?.questions[0]).not.toHaveProperty('correctAnswers');
    expect(result.quiz?.questions[0]).toHaveProperty('isMultipleChoice', false);
    expect(result.quiz?.questions[0]).toHaveProperty('maxSelectableOptions', 1);
    expect(result.quiz?.totalPoints).toBe(10);
    expect(result.quiz?.passScorePoints).toBe(7);
  });

  it('marks learner-safe MCQ questions as multiple choice when multiple answers are correct', async () => {
    arrangeValidContext(
      makeQuiz({
        questions: [makeMcqQuestion({ correctAnswers: [0, 2] })],
      }),
    );

    const result = await service.loadLearnerQuiz(learnerId, courseId, lessonId);

    expect(result.quiz?.questions[0]).toHaveProperty('isMultipleChoice', true);
    expect(result.quiz?.questions[0]).toHaveProperty('maxSelectableOptions', 2);
    expect(result.quiz?.questions[0]).not.toHaveProperty('correctAnswers');
  });

  it('returns null when the lesson has no quiz', async () => {
    arrangeValidContext(null);

    await expect(
      service.loadLearnerQuiz(learnerId, courseId, lessonId),
    ).resolves.toEqual({ quiz: null });
  });

  it('starts a new in-progress attempt every time', async () => {
    arrangeValidContext(makeQuiz({ questions: [makeMcqQuestion()] }));

    const result = await service.startAttempt(
      learnerId,
      courseId,
      lessonId,
      quizId,
    );

    expect(attemptsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        learnerId,
        quizId,
        status: QuizAttemptStatus.IN_PROGRESS,
        startedAt: now,
        timeLimitMinutes: 30,
      }),
    );
    expect(result.quiz.questions[0]).not.toHaveProperty('correctAnswers');
  });

  it('allows starting an attempt when submitted attempts are below the limit', async () => {
    arrangeValidContext(makeQuiz({ questions: [makeMcqQuestion()] }));
    attemptsRepository.count.mockResolvedValue(2);

    await service.startAttempt(learnerId, courseId, lessonId, quizId);

    expect(attemptsRepository.count).toHaveBeenCalledWith({
      where: { learnerId, quizId, submittedAt: Not(IsNull()) },
    });
    expect(attemptsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        learnerId,
        quizId,
        status: QuizAttemptStatus.IN_PROGRESS,
      }),
    );
  });

  it('rejects starting an attempt when submitted attempts reached the limit', async () => {
    arrangeValidContext(makeQuiz({ questions: [makeMcqQuestion()] }));
    attemptsRepository.count.mockResolvedValue(3);

    await expect(
      service.startAttempt(learnerId, courseId, lessonId, quizId),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(attemptsRepository.count).toHaveBeenCalledWith({
      where: { learnerId, quizId, submittedAt: Not(IsNull()) },
    });
    expect(attemptsRepository.create).not.toHaveBeenCalled();
  });

  it('stores expiry 48 hours after the timed quiz deadline', async () => {
    arrangeValidContext(makeQuiz({ timeLimitMinutes: 30 }));

    await service.startAttempt(learnerId, courseId, lessonId, quizId);

    expect(attemptsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        startedAt: now,
        timeLimitMinutes: 30,
        expiresAt: new Date('2026-09-02T10:30:00.000Z'),
      }),
    );
  });

  it('stores expiry 48 hours after start for no-time-limit quiz', async () => {
    arrangeValidContext(makeQuiz({ timeLimitMinutes: null }));

    await service.startAttempt(learnerId, courseId, lessonId, quizId);

    expect(attemptsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        startedAt: now,
        timeLimitMinutes: null,
        expiresAt: new Date('2026-09-02T10:00:00.000Z'),
      }),
    );
  });

  it('gives partial MCQ score based on selected correct answers and ignores wrong selections', async () => {
    arrangeSubmitContext({
      questions: [makeMcqQuestion({ points: 10, correctAnswers: [1, 3] })],
    });

    const result = await service.submitAttempt(
      learnerId,
      courseId,
      lessonId,
      quizId,
      attemptId,
      { answers: [{ questionId, selectedOptionIndexes: [1, 2] }] },
    );

    expect(result.totalScore).toBe(5);
    expect(result.questions[0]).toMatchObject({
      score: 5,
      maxScore: 10,
      status: 'partial',
    });
  });

  it('counts duplicate selected correct options once', async () => {
    arrangeSubmitContext({
      questions: [makeMcqQuestion({ points: 10, correctAnswers: [0, 1] })],
    });

    const result = await service.submitAttempt(
      learnerId,
      courseId,
      lessonId,
      quizId,
      attemptId,
      { answers: [{ questionId, selectedOptionIndexes: [0, 0] }] },
    );

    expect(result.totalScore).toBe(5);
  });

  it('rejects invalid option indexes', async () => {
    arrangeSubmitContext();

    await expect(
      service.submitAttempt(learnerId, courseId, lessonId, quizId, attemptId, {
        answers: [{ questionId, selectedOptionIndexes: [4] }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects selecting more MCQ options than there are correct answers', async () => {
    arrangeSubmitContext({
      questions: [makeMcqQuestion({ correctAnswers: [0, 2] })],
    });

    await expect(
      service.submitAttempt(learnerId, courseId, lessonId, quizId, attemptId, {
        answers: [{ questionId, selectedOptionIndexes: [0, 1, 2] }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('marks essay as pending and scores it zero', async () => {
    arrangeSubmitContext({ questions: [makeEssayQuestion({ points: 10 })] });

    const result = await service.submitAttempt(
      learnerId,
      courseId,
      lessonId,
      quizId,
      attemptId,
      { answers: [{ questionId: essayQuestionId, text: 'My answer' }] },
    );

    expect(result.totalScore).toBe(0);
    expect(result.pendingEssayCount).toBe(1);
    expect(result.questions[0].status).toBe('pending_grading');
  });

  it('does not pass while essay answers are pending even when MCQ score reaches the threshold', async () => {
    arrangeSubmitContext({
      quiz: makeQuiz({
        passScore: 50,
        questions: [
          makeMcqQuestion({ points: 10 }),
          makeEssayQuestion({ points: 10 }),
        ],
      }),
    });

    const result = await service.submitAttempt(
      learnerId,
      courseId,
      lessonId,
      quizId,
      attemptId,
      {
        answers: [
          { questionId, selectedOptionIndexes: [0] },
          { questionId: essayQuestionId, text: 'Pending essay' },
        ],
      },
    );

    expect(result.totalScore).toBe(10);
    expect(result.passScorePoints).toBe(10);
    expect(result.pendingEssayCount).toBe(1);
    expect(result.passed).toBe(false);
    expect(result.status).toBe(QuizAttemptStatus.NOT_PASSED);
    expect(
      learningProgressService.recomputeLessonAndEnrollmentProgress,
    ).not.toHaveBeenCalled();
  });

  it('enqueues instructor notification when submitted attempt has pending essay answers', async () => {
    arrangeSubmitContext({
      questions: [makeMcqQuestion(), makeEssayQuestion()],
    });

    await service.submitAttempt(
      learnerId,
      courseId,
      lessonId,
      quizId,
      attemptId,
      {
        answers: [
          { questionId, selectedOptionIndexes: [0] },
          { questionId: essayQuestionId, text: 'My essay answer' },
        ],
      },
    );

    expect(
      notificationsQueueService.enqueueCreateNotification,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'direct',
        targetUserId: '88888888-8888-4888-8888-888888888888',
        actionUrl: '/instructor/essay-grading',
        triggerKey: `essay-submitted:${attemptId}`,
        triggerDate: '2026-08-31',
        metadata: expect.objectContaining({
          attemptId,
          quizId,
          courseId,
          lessonId,
          learnerId,
          instructorId: '88888888-8888-4888-8888-888888888888',
          pendingEssayCount: 1,
        }),
      }),
    );
  });

  it('does not enqueue essay notification when submitted attempt has no pending essays', async () => {
    arrangeSubmitContext({ questions: [makeMcqQuestion()] });

    await service.submitAttempt(
      learnerId,
      courseId,
      lessonId,
      quizId,
      attemptId,
      { answers: [{ questionId, selectedOptionIndexes: [0] }] },
    );

    expect(
      notificationsQueueService.enqueueCreateNotification,
    ).not.toHaveBeenCalled();
  });

  it('does not enqueue essay notification when quiz submission fails before commit', async () => {
    arrangeSubmitContext({ questions: [makeMcqQuestion()] });
    queryRunner.commitTransaction.mockRejectedValueOnce(
      new Error('commit failed'),
    );

    await expect(
      service.submitAttempt(learnerId, courseId, lessonId, quizId, attemptId, {
        answers: [{ questionId, selectedOptionIndexes: [0] }],
      }),
    ).rejects.toThrow('commit failed');

    expect(
      notificationsQueueService.enqueueCreateNotification,
    ).not.toHaveBeenCalled();
  });

  it('keeps quiz submission successful when essay notification enqueue fails', async () => {
    arrangeSubmitContext({
      questions: [makeMcqQuestion(), makeEssayQuestion()],
    });
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();
    notificationsQueueService.enqueueCreateNotification.mockImplementationOnce(
      () => {
        throw new Error('queue unavailable');
      },
    );

    await expect(
      service.submitAttempt(learnerId, courseId, lessonId, quizId, attemptId, {
        answers: [
          { questionId, selectedOptionIndexes: [0] },
          { questionId: essayQuestionId, text: 'My essay answer' },
        ],
      }),
    ).resolves.toMatchObject({ attemptId, pendingEssayCount: 1 });

    loggerSpy.mockRestore();
  });

  it('passes when score equals pass score boundary', async () => {
    arrangeSubmitContext({
      quiz: makeQuiz({ passScore: 50, questions: [makeMcqQuestion()] }),
    });

    const result = await service.submitAttempt(
      learnerId,
      courseId,
      lessonId,
      quizId,
      attemptId,
      { answers: [{ questionId, selectedOptionIndexes: [0] }] },
    );

    expect(result.passScorePoints).toBe(5);
    expect(result.passed).toBe(true);
    expect(result.status).toBe(QuizAttemptStatus.PASSED);
  });

  it('does not recompute progress when submitted attempt fails', async () => {
    arrangeSubmitContext({
      quiz: makeQuiz({ passScore: 70, questions: [makeMcqQuestion()] }),
    });

    const result = await service.submitAttempt(
      learnerId,
      courseId,
      lessonId,
      quizId,
      attemptId,
      { answers: [{ questionId, selectedOptionIndexes: [1] }] },
    );

    expect(result.passed).toBe(false);
    expect(result.status).toBe(QuizAttemptStatus.NOT_PASSED);
    expect(
      learningProgressService.recomputeLessonAndEnrollmentProgress,
    ).not.toHaveBeenCalled();
  });

  it('recomputes progress when submitted attempt passes', async () => {
    arrangeSubmitContext({
      quiz: makeQuiz({ passScore: 70, questions: [makeMcqQuestion()] }),
    });

    const result = await service.submitAttempt(
      learnerId,
      courseId,
      lessonId,
      quizId,
      attemptId,
      { answers: [{ questionId, selectedOptionIndexes: [0] }] },
    );

    expect(result.passed).toBe(true);
    expect(result.status).toBe(QuizAttemptStatus.PASSED);
    expect(
      learningProgressService.recomputeLessonAndEnrollmentProgress,
    ).toHaveBeenCalledWith(learnerId, courseId, lessonId);
  });

  it('accepts late submission and records late seconds', async () => {
    arrangeSubmitContext({
      quiz: makeQuiz({ timeLimitMinutes: 10 }),
      attempt: makeAttempt({
        startedAt: new Date('2026-08-31T09:49:00.000Z'),
        timeLimitMinutes: 10,
      }),
    });

    const result = await service.submitAttempt(
      learnerId,
      courseId,
      lessonId,
      quizId,
      attemptId,
      { answers: [{ questionId, selectedOptionIndexes: [0] }] },
    );

    expect(result.isLate).toBe(true);
    expect(result.lateSeconds).toBe(60);
  });

  it('rejects submission after the attempt expiry time', async () => {
    arrangeSubmitContext({
      attempt: makeAttempt({
        expiresAt: new Date('2026-08-31T09:59:59.000Z'),
      }),
    });

    await expect(
      service.submitAttempt(learnerId, courseId, lessonId, quizId, attemptId, {
        answers: [{ questionId, selectedOptionIndexes: [0] }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows submission exactly at the attempt expiry time', async () => {
    arrangeSubmitContext({
      attempt: makeAttempt({ expiresAt: now }),
    });

    const result = await service.submitAttempt(
      learnerId,
      courseId,
      lessonId,
      quizId,
      attemptId,
      { answers: [{ questionId, selectedOptionIndexes: [0] }] },
    );

    expect(result.totalScore).toBe(10);
  });

  it('rejects legacy attempts without stored expiry after computed expiry', async () => {
    arrangeSubmitContext({
      attempt: makeAttempt({
        startedAt: new Date('2026-08-29T09:29:59.000Z'),
        expiresAt: null,
      }),
    });

    await expect(
      service.submitAttempt(learnerId, courseId, lessonId, quizId, attemptId, {
        answers: [{ questionId, selectedOptionIndexes: [0] }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not mark no-time-limit attempts late', async () => {
    arrangeSubmitContext({
      quiz: makeQuiz({ timeLimitMinutes: null }),
      attempt: makeAttempt({ timeLimitMinutes: null }),
    });

    const result = await service.submitAttempt(
      learnerId,
      courseId,
      lessonId,
      quizId,
      attemptId,
      { answers: [{ questionId, selectedOptionIndexes: [0] }] },
    );

    expect(result.isLate).toBe(false);
    expect(result.lateSeconds).toBe(0);
  });

  it('rejects a second submit for the same attempt with conflict', async () => {
    arrangeSubmitContext({
      attempt: makeAttempt({
        submittedAt: now,
        status: QuizAttemptStatus.PASSED,
      }),
    });

    await expect(
      service.submitAttempt(learnerId, courseId, lessonId, quizId, attemptId, {
        answers: [{ questionId, selectedOptionIndexes: [0] }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects non-enrolled learners', async () => {
    coursesRepository.findOne.mockResolvedValue(makeCourse());
    enrollmentsRepository.findOne.mockResolvedValue(null);

    await expect(
      service.loadLearnerQuiz(learnerId, courseId, lessonId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects unpublished courses as not found', async () => {
    coursesRepository.findOne.mockResolvedValue(
      makeCourse({ status: CourseStatus.DRAFT }),
    );

    await expect(
      service.loadLearnerQuiz(learnerId, courseId, lessonId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects sequentially blocked lessons', async () => {
    coursesRepository.findOne.mockResolvedValue(
      makeCourse({ learningOrder: CourseLearningOrder.SEQUENTIAL }),
    );
    enrollmentsRepository.findOne.mockResolvedValue(makeEnrollment());
    lessonsRepository.findOne.mockResolvedValue(
      makeLesson({
        id: lessonId,
        position: 1,
      }),
    );
    lessonsRepository.find.mockResolvedValue([
      makeLesson({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        position: 0,
      }),
      makeLesson({ id: lessonId, position: 1 }),
    ]);
    learningProgressService.getCompletedLessonIds.mockResolvedValue(
      new Set<string>(),
    );

    await expect(
      service.loadLearnerQuiz(learnerId, courseId, lessonId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects missing quiz on start', async () => {
    arrangeValidContext(null);

    await expect(
      service.startAttempt(learnerId, courseId, lessonId, quizId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('accepts missing MCQ answers and grades them wrong with zero score', async () => {
    arrangeSubmitContext({ questions: [makeMcqQuestion()] });

    const result = await service.submitAttempt(
      learnerId,
      courseId,
      lessonId,
      quizId,
      attemptId,
      { answers: [] },
    );

    expect(result.totalScore).toBe(0);
    expect(result.wrongCount).toBe(1);
    expect(result.questions).toEqual([
      expect.objectContaining({
        questionId,
        selectedOptionIndexes: [],
        score: 0,
        status: 'wrong',
      }),
    ]);
  });

  it('accepts missing essay answers and records empty pending grading', async () => {
    arrangeSubmitContext({ questions: [makeEssayQuestion()] });

    const result = await service.submitAttempt(
      learnerId,
      courseId,
      lessonId,
      quizId,
      attemptId,
      { answers: [] },
    );

    expect(result.totalScore).toBe(0);
    expect(result.pendingEssayCount).toBe(1);
    expect(result.questions).toEqual([
      expect.objectContaining({
        questionId: essayQuestionId,
        text: '',
        score: 0,
        status: 'pending_grading',
      }),
    ]);
  });

  it('rejects answers for questions that do not belong to the quiz', async () => {
    arrangeSubmitContext();

    await expect(
      service.submitAttempt(learnerId, courseId, lessonId, quizId, attemptId, {
        answers: [
          { questionId, selectedOptionIndexes: [0] },
          {
            questionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            selectedOptionIndexes: [0],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate answers for the same question', async () => {
    arrangeSubmitContext();

    await expect(
      service.submitAttempt(learnerId, courseId, lessonId, quizId, attemptId, {
        answers: [
          { questionId, selectedOptionIndexes: [0] },
          { questionId, selectedOptionIndexes: [0] },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a locked attempt row that belongs to another learner', async () => {
    arrangeSubmitContext({
      attempt: makeAttempt({
        learnerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    });

    await expect(
      service.submitAttempt(learnerId, courseId, lessonId, quizId, attemptId, {
        answers: [{ questionId, selectedOptionIndexes: [0] }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rolls back and releases the query runner when submission fails', async () => {
    arrangeSubmitContext();

    await expect(
      service.submitAttempt(learnerId, courseId, lessonId, quizId, attemptId, {
        answers: [{ questionId, selectedOptionIndexes: [9] }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
  });

  it('locks the attempt row during submission', async () => {
    arrangeSubmitContext();

    await service.submitAttempt(
      learnerId,
      courseId,
      lessonId,
      quizId,
      attemptId,
      {
        answers: [{ questionId, selectedOptionIndexes: [0] }],
      },
    );

    expect(queryRunner.manager.findOne).toHaveBeenCalledWith(
      QuizAttempt,
      expect.objectContaining({
        lock: { mode: 'pessimistic_write' },
        where: { id: attemptId, quizId, learnerId },
      }),
    );
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
  });

  it('persists an analytics event for quiz submission', async () => {
    arrangeSubmitContext();

    await service.submitAttempt(
      learnerId,
      courseId,
      lessonId,
      quizId,
      attemptId,
      {
        answers: [{ questionId, selectedOptionIndexes: [0] }],
      },
    );

    expect(analyticsEventsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        learnerId,
        courseId,
        lessonId,
        eventType: 'quiz_submitted',
        payload: expect.objectContaining({
          quizId,
          attemptId,
          totalScore: 10,
          totalPoints: 10,
          passed: true,
          isLate: false,
          lateSeconds: 0,
        }),
      }),
    );
  });

  it('lists learner attempt history newest first with snapshots', async () => {
    arrangeValidContext(makeQuiz());
    attemptsRepository.find.mockResolvedValue([
      makeAttempt({
        id: 'new',
        submittedAt: new Date('2026-08-31T10:10:00.000Z'),
        gradingResult: [],
      }),
      makeAttempt({
        id: 'old',
        submittedAt: new Date('2026-08-31T10:00:00.000Z'),
        gradingResult: [],
      }),
    ]);

    const result = await service.listAttempts(
      learnerId,
      courseId,
      lessonId,
      quizId,
    );

    expect(result.map((attempt) => attempt.attemptId)).toEqual(['new', 'old']);
    expect(attemptsRepository.find).toHaveBeenCalledWith({
      where: { learnerId, quizId, submittedAt: expect.anything() },
      order: { submittedAt: 'DESC', createdAt: 'DESC' },
    });
    expect(attemptsRepository.find.mock.calls[0][0].where.submittedAt).toEqual(
      expect.any(Object),
    );
  });
});
