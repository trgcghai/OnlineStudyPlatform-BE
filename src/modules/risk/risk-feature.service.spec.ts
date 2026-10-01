import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { LearningAnalyticsEvent } from '../learning/entities/learning-analytics-event.entity';
import { LessonProgress } from '../learning/entities/lesson-progress.entity';
import {
  LessonWatchEvent,
  LessonWatchEventType,
} from '../learning/entities/lesson-watch-event.entity';
import { QuizAttemptStatus } from '../quizzes/dto/quiz-attempt.dto';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { RiskFeatureService } from './risk-feature.service';

type MockRepo<T> = Partial<Record<keyof Repository<T>, jest.Mock>>;

function repo<T>(): MockRepo<T> {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
  };
}

describe('RiskFeatureService', () => {
  let service: RiskFeatureService;
  let enrollments: MockRepo<Enrollment>;
  let events: MockRepo<LearningAnalyticsEvent>;
  let progress: MockRepo<LessonProgress>;
  let watchEvents: MockRepo<LessonWatchEvent>;
  let attempts: MockRepo<QuizAttempt>;

  beforeEach(async () => {
    enrollments = repo<Enrollment>();
    events = repo<LearningAnalyticsEvent>();
    progress = repo<LessonProgress>();
    watchEvents = repo<LessonWatchEvent>();
    attempts = repo<QuizAttempt>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RiskFeatureService,
        { provide: getRepositoryToken(Enrollment), useValue: enrollments },
        {
          provide: getRepositoryToken(LearningAnalyticsEvent),
          useValue: events,
        },
        { provide: getRepositoryToken(LessonProgress), useValue: progress },
        {
          provide: getRepositoryToken(LessonWatchEvent),
          useValue: watchEvents,
        },
        { provide: getRepositoryToken(QuizAttempt), useValue: attempts },
      ],
    }).compile();

    service = moduleRef.get(RiskFeatureService);
  });

  it('defaults missing events and learning data to safe numeric values', async () => {
    const now = new Date('2026-09-30T00:00:00Z');
    enrollments.findOne!.mockResolvedValue({
      id: 'enrollment-1',
      learnerId: 'learner-1',
      courseId: 'course-1',
      enrolledAt: new Date('2026-09-20T00:00:00Z'),
      completedAt: null,
      progress: '10.00',
    });
    events.find!.mockResolvedValue([]);
    progress.find!.mockResolvedValue([]);
    watchEvents.find!.mockResolvedValue([]);
    attempts.find!.mockResolvedValue([]);

    const result = await service.extractForLearnerCourse(
      'learner-1',
      'course-1',
      now,
    );

    expect(result.features.lastActivityDays).toBe(10);
    expect(result.features.activityCount7d).toBe(0);
    expect(result.features.courseProgressPercent).toBe(10);
    expect(result.features.expectedProgressGap).toBe(20);
    expect(result.features.quizScoreAvgPercent).toBe(0);
    expect(result.features.watchRatioAvg).toBe(0);
  });

  it('maps quiz attempts to a course through quiz and lesson relations', async () => {
    const now = new Date('2026-09-30T00:00:00Z');
    enrollments.findOne!.mockResolvedValue({
      id: 'enrollment-1',
      learnerId: 'learner-1',
      courseId: 'course-1',
      enrolledAt: new Date('2026-09-29T00:00:00Z'),
      completedAt: null,
      progress: '0.00',
    });
    events.find!.mockResolvedValue([{ createdAt: now }]);
    progress.find!.mockResolvedValue([]);
    watchEvents.find!.mockResolvedValue([]);
    attempts.find!.mockResolvedValue([
      {
        learnerId: 'learner-1',
        status: QuizAttemptStatus.PASSED,
        score: '8.00',
        totalPoints: '10.00',
        passed: true,
        isLate: false,
        quiz: { lesson: { courseId: 'course-1' } },
      },
      {
        learnerId: 'learner-1',
        status: QuizAttemptStatus.NOT_PASSED,
        score: '4.00',
        totalPoints: '10.00',
        passed: false,
        isLate: true,
        quiz: { lesson: { courseId: 'other-course' } },
      },
    ]);

    const result = await service.extractForLearnerCourse(
      'learner-1',
      'course-1',
      now,
    );

    expect(result.features.quizScoreAvgPercent).toBe(80);
    expect(result.features.quizPassRate).toBe(1);
    expect(result.features.lateQuizCount).toBe(0);
  });

  it('counts paused watch events and lesson progress metrics', async () => {
    const now = new Date('2026-09-30T00:00:00Z');
    enrollments.findOne!.mockResolvedValue({
      id: 'enrollment-1',
      learnerId: 'learner-1',
      courseId: 'course-1',
      enrolledAt: new Date('2026-09-28T00:00:00Z'),
      completedAt: null,
      progress: '50.00',
    });
    events.find!.mockResolvedValue([{ createdAt: now }]);
    progress.find!.mockResolvedValue([
      { watchRatio: '0.5000', watchedSeconds: 100, lessonCompletedAt: now },
      { watchRatio: '1.0000', watchedSeconds: 200, lessonCompletedAt: null },
    ]);
    watchEvents.find!.mockResolvedValue([
      { eventType: LessonWatchEventType.PAUSED },
      { eventType: LessonWatchEventType.OPENED },
    ]);
    attempts.find!.mockResolvedValue([]);

    const result = await service.extractForLearnerCourse(
      'learner-1',
      'course-1',
      now,
    );

    expect(result.features.watchRatioAvg).toBe(0.75);
    expect(result.features.totalWatchedSeconds).toBe(300);
    expect(result.features.pauseCount).toBe(1);
    expect(result.features.completionVelocity).toBe(0.5);
  });
});
