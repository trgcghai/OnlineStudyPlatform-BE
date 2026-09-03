import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, Not } from 'typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { LearningAnalyticsEvent } from '../learning/entities/learning-analytics-event.entity';
import { LessonProgress } from '../learning/entities/lesson-progress.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { QuizAttemptStatus } from '../quizzes/dto/quiz-attempt.dto';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { LearnerDashboardService } from './learner-dashboard.service';

const learnerId = '11111111-1111-4111-8111-111111111111';
const otherLearnerId = '22222222-2222-4222-8222-222222222222';
const courseAId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const courseBId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const lessonA1Id = 'a1111111-1111-4111-8111-111111111111';
const lessonA2Id = 'a2222222-2222-4222-8222-222222222222';
const lessonB1Id = 'b1111111-1111-4111-8111-111111111111';

function mockRepository() {
  return {
    find: jest.fn(),
  };
}

function makeEnrollment(overrides: Partial<Enrollment> = {}): Enrollment {
  return {
    id: 'enrollment-id',
    learnerId,
    learner: undefined as never,
    courseId: courseAId,
    course: {
      id: courseAId,
      title: 'Course A',
      description: 'Course A description',
      category: 'Programming',
      thumbnail: null,
      instructorId: 'instructor-id',
      instructor: { id: 'instructor-id', name: 'Instructor A' },
    } as never,
    enrolledAt: new Date('2026-09-01T00:00:00.000Z'),
    completedAt: null,
    progress: '25.00',
    updatedAt: new Date('2026-09-02T00:00:00.000Z'),
    ...overrides,
  };
}

function makeLesson(id: string, courseId: string, position: number): Lesson {
  return {
    id,
    courseId,
    title: `Lesson ${position}`,
    description: '',
    videoUrl: null,
    materialUrl: null,
    duration: 600,
    position,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  } as Lesson;
}

function makeCompletedProgress(
  lessonId: string,
  courseId: string,
): LessonProgress {
  return {
    id: `progress-${lessonId}`,
    learnerId,
    courseId,
    lessonId,
    lessonCompletedAt: new Date('2026-09-02T00:00:00.000Z'),
  } as LessonProgress;
}

function makeAttempt(overrides: Partial<QuizAttempt> = {}): QuizAttempt {
  return {
    id: 'attempt-id',
    quizId: 'quiz-id',
    quiz: {
      id: 'quiz-id',
      lessonId: lessonA1Id,
      lesson: { id: lessonA1Id, courseId: courseAId },
    } as never,
    learnerId,
    status: QuizAttemptStatus.PASSED,
    score: '80.00',
    totalPoints: '100.00',
    passed: true,
    answers: null,
    gradingResult: null,
    correctCount: 8,
    wrongCount: 2,
    pendingEssayCount: 0,
    startedAt: new Date('2026-09-01T00:00:00.000Z'),
    submittedAt: new Date('2026-09-01T00:10:00.000Z'),
    timeLimitMinutes: null,
    expiresAt: null,
    isLate: false,
    lateSeconds: 0,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:10:00.000Z'),
    ...overrides,
  } as QuizAttempt;
}

function makeActivity(
  overrides: Partial<LearningAnalyticsEvent> = {},
): LearningAnalyticsEvent {
  return {
    id: 'activity-id',
    learnerId,
    courseId: courseAId,
    lessonId: lessonA1Id,
    eventType: 'opened',
    payload: {},
    clientCreatedAt: new Date('2026-09-02T09:00:00.000Z'),
    createdAt: new Date('2026-09-02T09:00:01.000Z'),
    ...overrides,
  };
}

describe('LearnerDashboardService', () => {
  let service: LearnerDashboardService;
  let enrollmentsRepository: ReturnType<typeof mockRepository>;
  let lessonsRepository: ReturnType<typeof mockRepository>;
  let lessonProgressRepository: ReturnType<typeof mockRepository>;
  let quizAttemptsRepository: ReturnType<typeof mockRepository>;
  let analyticsEventsRepository: ReturnType<typeof mockRepository>;

  beforeEach(async () => {
    enrollmentsRepository = mockRepository();
    lessonsRepository = mockRepository();
    lessonProgressRepository = mockRepository();
    quizAttemptsRepository = mockRepository();
    analyticsEventsRepository = mockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LearnerDashboardService,
        {
          provide: getRepositoryToken(Enrollment),
          useValue: enrollmentsRepository,
        },
        { provide: getRepositoryToken(Lesson), useValue: lessonsRepository },
        {
          provide: getRepositoryToken(LessonProgress),
          useValue: lessonProgressRepository,
        },
        {
          provide: getRepositoryToken(QuizAttempt),
          useValue: quizAttemptsRepository,
        },
        {
          provide: getRepositoryToken(LearningAnalyticsEvent),
          useValue: analyticsEventsRepository,
        },
      ],
    }).compile();

    service = module.get(LearnerDashboardService);
    enrollmentsRepository.find.mockResolvedValue([]);
    lessonsRepository.find.mockResolvedValue([]);
    lessonProgressRepository.find.mockResolvedValue([]);
    quizAttemptsRepository.find.mockResolvedValue([]);
    analyticsEventsRepository.find.mockResolvedValue([]);
  });

  it('returns an empty dashboard when the learner has no enrollments', async () => {
    const result = await service.getDashboard(learnerId);

    expect(result).toEqual({
      summary: {
        enrolledCourseCount: 0,
        completedCourseCount: 0,
        averageProgressPercent: 0,
        averageQuizScorePercent: null,
      },
      courses: [],
      recentActivities: [],
    });
    expect(enrollmentsRepository.find).toHaveBeenCalledWith({
      where: { learnerId },
      relations: { course: { instructor: true } },
      order: { enrolledAt: 'DESC' },
    });
  });

  it('builds course rows from owned enrollments with progress and status', async () => {
    enrollmentsRepository.find.mockResolvedValue([
      makeEnrollment({
        id: 'enrollment-a',
        courseId: courseAId,
        progress: '25.00',
      }),
      makeEnrollment({
        id: 'enrollment-b',
        courseId: courseBId,
        progress: '100.00',
        completedAt: new Date('2026-09-03T00:00:00.000Z'),
        course: {
          id: courseBId,
          title: 'Course B',
          description: 'Course B description',
          category: 'Data',
          thumbnail: 'https://cdn.example.test/course-b.png',
          instructorId: 'instructor-b',
          instructor: { id: 'instructor-b', name: 'Instructor B' },
        } as never,
      }),
    ]);
    lessonsRepository.find.mockResolvedValue([
      makeLesson(lessonA1Id, courseAId, 1),
      makeLesson(lessonA2Id, courseAId, 2),
      makeLesson(lessonB1Id, courseBId, 1),
    ]);
    lessonProgressRepository.find.mockResolvedValue([
      makeCompletedProgress(lessonA1Id, courseAId),
      makeCompletedProgress(lessonB1Id, courseBId),
    ]);

    const result = await service.getDashboard(learnerId);

    expect(result.courses).toEqual([
      expect.objectContaining({
        enrollmentId: 'enrollment-a',
        courseId: courseAId,
        title: 'Course A',
        thumbnail: null,
        category: 'Programming',
        instructorName: 'Instructor A',
        progressPercent: 25,
        completionRatePercent: 50,
        status: 'in_progress',
        continueLearning: {
          courseId: courseAId,
          lessonId: lessonA2Id,
          href: `/learner/courses/${courseAId}/learn`,
        },
      }),
      expect.objectContaining({
        enrollmentId: 'enrollment-b',
        courseId: courseBId,
        title: 'Course B',
        thumbnail: 'https://cdn.example.test/course-b.png',
        category: 'Data',
        instructorName: 'Instructor B',
        progressPercent: 100,
        completionRatePercent: 100,
        status: 'completed',
        continueLearning: {
          courseId: courseBId,
          lessonId: lessonB1Id,
          href: `/learner/courses/${courseBId}/learn`,
        },
      }),
    ]);
    expect(result.summary.enrolledCourseCount).toBe(2);
    expect(result.summary.completedCourseCount).toBe(1);
    expect(result.summary.averageProgressPercent).toBe(62.5);
    expect(lessonsRepository.find).toHaveBeenCalledWith({
      where: { courseId: expect.any(Object) },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    expect(lessonProgressRepository.find).toHaveBeenCalledWith({
      where: {
        learnerId,
        courseId: expect.any(Object),
        lessonCompletedAt: Not(IsNull()),
      },
    });
    expect(quizAttemptsRepository.find).toHaveBeenCalledWith({
      where: {
        learnerId,
        status: expect.any(Object),
        submittedAt: Not(IsNull()),
      },
      relations: { quiz: { lesson: true } },
    });
    expect(analyticsEventsRepository.find).toHaveBeenCalledWith({
      where: { learnerId, courseId: expect.any(Object) },
      order: { createdAt: 'DESC' },
      take: 5,
    });
  });

  it('selects the highest submitted quiz score per enrolled course', async () => {
    enrollmentsRepository.find.mockResolvedValue([
      makeEnrollment({ id: 'enrollment-a', courseId: courseAId }),
    ]);
    lessonsRepository.find.mockResolvedValue([
      makeLesson(lessonA1Id, courseAId, 1),
    ]);
    quizAttemptsRepository.find.mockResolvedValue([
      makeAttempt({ id: 'attempt-low', score: '50.00', totalPoints: '100.00' }),
      makeAttempt({ id: 'attempt-high', score: '18.00', totalPoints: '20.00' }),
    ]);

    const result = await service.getDashboard(learnerId);

    expect(result.courses[0].bestQuizScorePercent).toBe(90);
    expect(result.courses[0].bestQuizAttempt).toEqual({
      quizId: 'quiz-id',
      attemptId: 'attempt-high',
      score: 18,
      totalPoints: 20,
      submittedAt: new Date('2026-09-01T00:10:00.000Z'),
      passed: true,
    });
    expect(result.summary.averageQuizScorePercent).toBe(90);
    expect(quizAttemptsRepository.find).toHaveBeenCalledWith({
      where: {
        learnerId,
        status: expect.any(Object),
        submittedAt: Not(IsNull()),
      },
      relations: { quiz: { lesson: true } },
    });
  });

  it('ignores invalid quiz attempts and returns null when no valid submitted score exists', async () => {
    enrollmentsRepository.find.mockResolvedValue([
      makeEnrollment({ id: 'enrollment-a', courseId: courseAId }),
    ]);
    lessonsRepository.find.mockResolvedValue([
      makeLesson(lessonA1Id, courseAId, 1),
    ]);
    quizAttemptsRepository.find.mockResolvedValue([
      makeAttempt({ id: 'abandoned', status: QuizAttemptStatus.ABANDONED }),
      makeAttempt({ id: 'in-progress', status: QuizAttemptStatus.IN_PROGRESS }),
      makeAttempt({ id: 'unsubmitted', submittedAt: null }),
      makeAttempt({ id: 'zero-total', totalPoints: '0.00' }),
      makeAttempt({ id: 'other-learner', learnerId: otherLearnerId }),
    ]);

    const result = await service.getDashboard(learnerId);

    expect(result.courses[0].bestQuizScorePercent).toBeNull();
    expect(result.courses[0].bestQuizAttempt).toBeNull();
    expect(result.summary.averageQuizScorePercent).toBeNull();
  });

  it('maps recent activities for owned enrolled courses', async () => {
    enrollmentsRepository.find.mockResolvedValue([
      makeEnrollment({ id: 'enrollment-a', courseId: courseAId }),
    ]);
    lessonsRepository.find.mockResolvedValue([
      makeLesson(lessonA1Id, courseAId, 1),
    ]);
    analyticsEventsRepository.find.mockResolvedValue([
      makeActivity({ id: 'activity-a' }),
      makeActivity({
        id: 'activity-without-lesson',
        lessonId: null,
        eventType: 'heartbeat',
      }),
    ]);

    const result = await service.getDashboard(learnerId);

    expect(result.recentActivities).toEqual([
      {
        id: 'activity-a',
        courseId: courseAId,
        lessonId: lessonA1Id,
        courseTitle: 'Course A',
        lessonTitle: 'Lesson 1',
        eventType: 'opened',
        occurredAt: new Date('2026-09-02T09:00:01.000Z'),
      },
      {
        id: 'activity-without-lesson',
        courseId: courseAId,
        lessonId: null,
        courseTitle: 'Course A',
        lessonTitle: null,
        eventType: 'heartbeat',
        occurredAt: new Date('2026-09-02T09:00:01.000Z'),
      },
    ]);
  });
});
