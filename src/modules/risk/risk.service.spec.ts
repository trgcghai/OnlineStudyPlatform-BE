import { ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Course } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { RiskBand, RiskScoreResult } from './dto/risk.dto';
import { RiskFeatureService } from './risk-feature.service';
import { RiskPersistenceService } from './risk-persistence.service';
import { RiskScoringService } from './risk-scoring.service';
import { RiskService } from './risk.service';

describe('RiskService', () => {
  let service: RiskService;
  let coursesRepository: { findOne: jest.Mock };
  let featureService: {
    getActiveEnrollmentsForCourse: jest.Mock;
    extractForLearnerCourse: jest.Mock;
  };
  let scoringService: { score: jest.Mock };
  let persistenceService: {
    upsertScore: jest.Mock;
    findLatestByCourse: jest.Mock;
    findHistory: jest.Mock;
  };

  beforeEach(async () => {
    coursesRepository = { findOne: jest.fn() };
    featureService = {
      getActiveEnrollmentsForCourse: jest.fn(),
      extractForLearnerCourse: jest.fn(),
    };
    scoringService = { score: jest.fn() };
    persistenceService = {
      upsertScore: jest.fn(),
      findLatestByCourse: jest.fn(),
      findHistory: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RiskService,
        { provide: getRepositoryToken(Course), useValue: coursesRepository },
        { provide: RiskFeatureService, useValue: featureService },
        { provide: RiskScoringService, useValue: scoringService },
        { provide: RiskPersistenceService, useValue: persistenceService },
      ],
    }).compile();

    service = moduleRef.get(RiskService);
  });

  it('rejects access to courses not owned by instructor', async () => {
    coursesRepository.findOne.mockResolvedValue({
      id: 'course-1',
      instructorId: 'other',
    });

    await expect(
      service.getSummary('course-1', 'instructor-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recomputes active course enrollments idempotently by learner-course-day', async () => {
    coursesRepository.findOne.mockResolvedValue({
      id: 'course-1',
      instructorId: 'instructor-1',
    });
    featureService.getActiveEnrollmentsForCourse.mockResolvedValue([
      { learnerId: 'learner-1', courseId: 'course-1' } as Enrollment,
    ]);
    featureService.extractForLearnerCourse.mockResolvedValue({
      learnerId: 'learner-1',
      courseId: 'course-1',
      enrollmentId: 'enrollment-1',
      features: {
        lastActivityDays: 1,
        activityCount7d: 5,
        expectedProgressGap: 0,
        courseProgressPercent: 50,
        quizScoreAvgPercent: 80,
        quizPassRate: 1,
        watchRatioAvg: 0.8,
        abandonedAttemptCount: 0,
        lateQuizCount: 0,
        completionVelocity: 1,
        totalWatchedSeconds: 100,
        pauseCount: 0,
      },
    });
    const score: RiskScoreResult = {
      score: 10,
      band: RiskBand.LOW,
      factors: [],
    };
    scoringService.score.mockReturnValue(score);
    persistenceService.upsertScore.mockResolvedValue({});

    const result = await service.recomputeCourse(
      'course-1',
      'instructor-1',
      new Date('2026-09-30T10:00:00Z'),
    );

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(persistenceService.upsertScore).toHaveBeenCalledWith(
      'risk:course-1:learner-1:2026-09-30',
      expect.objectContaining({ learnerId: 'learner-1', source: 'heuristic' }),
    );
  });

  it('summarizes latest scores by band', async () => {
    coursesRepository.findOne.mockResolvedValue({
      id: 'course-1',
      instructorId: 'instructor-1',
    });
    persistenceService.findLatestByCourse.mockResolvedValue([
      { band: RiskBand.HIGH, calculatedAt: new Date('2026-09-30T00:00:00Z') },
      { band: RiskBand.MEDIUM, calculatedAt: new Date('2026-09-29T00:00:00Z') },
    ]);

    const result = await service.getSummary('course-1', 'instructor-1');

    expect(result).toEqual({
      totalScoredLearners: 2,
      lowCount: 0,
      mediumCount: 1,
      highCount: 1,
      highRiskPercentage: 50,
      latestCalculatedAt: new Date('2026-09-30T00:00:00Z'),
    });
  });
});
