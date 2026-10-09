import {
  ServiceUnavailableException,
  ForbiddenException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Course } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { RiskBand, RiskScoreResponse } from './dto/risk.dto';
import { AiRiskClient } from './ai-risk.client';
import { RiskFeatureService } from './risk-feature.service';
import { RiskPersistenceService } from './risk-persistence.service';
import { RiskService } from './risk.service';

describe('RiskService', () => {
  let service: RiskService;
  let coursesRepository: { findOne: jest.Mock };
  let featureService: {
    getActiveEnrollmentsForCourse: jest.Mock;
    extractForLearnerCourse: jest.Mock;
  };
  let aiGateway: {
    predict: jest.Mock;
    getActiveModel: jest.Mock;
  };
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
    aiGateway = {
      predict: jest.fn(),
      getActiveModel: jest.fn(),
    };
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
        { provide: AiRiskClient, useValue: aiGateway },
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

  it('returns active model status from AI gateway', async () => {
    const status = {
      model: {
        modelName: 'dropout-risk-xgboost',
        modelVersion: 'dropout-xgb-v1',
        featureVersion: 'dropout_features_v1',
        trainedAt: '2026-10-01T00:00:00Z',
        sampleCount: 125,
        metrics: { mae: 7.8, rmse: 10.4 },
        artifactPath: 'models/dropout-risk/dropout-xgb-v1/model.json',
        isActive: true,
      },
    };
    aiGateway.getActiveModel.mockResolvedValue(status);

    await expect(service.getModel()).resolves.toBe(status);
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
    aiGateway.predict.mockResolvedValue({
      score: 10,
      band: RiskBand.LOW,
      modelVersion: 'dropout-xgb-v1',
      factors: [],
    });
    persistenceService.upsertScore.mockResolvedValue({});

    const result = await service.recomputeCourse(
      'course-1',
      'instructor-1',
      new Date('2026-09-30T10:00:00Z'),
    );

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(persistenceService.upsertScore).toHaveBeenCalledWith(
      'risk:course-1:learner-1:2026-09-30',
      expect.objectContaining({
        learnerId: 'learner-1',
        source: 'ai',
        scoringVersion: 'dropout-xgb-v1',
      }),
    );
  });

  it('persists AI score when AI prediction succeeds', async () => {
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
    aiGateway.predict.mockResolvedValue({
      score: 82.4,
      band: RiskBand.HIGH,
      modelVersion: 'dropout-xgb-v1',
      factors: [],
    });
    persistenceService.upsertScore.mockResolvedValue({});

    await service.recomputeLearnerCourse(
      'learner-1',
      'course-1',
      new Date('2026-09-30T10:00:00Z'),
    );

    expect(persistenceService.upsertScore).toHaveBeenCalledWith(
      'risk:course-1:learner-1:2026-09-30',
      expect.objectContaining({
        score: 82.4,
        band: RiskBand.HIGH,
        source: 'ai',
        scoringVersion: 'dropout-xgb-v1',
      }),
    );
  });

  it('fails learner recompute when AI prediction is unavailable', async () => {
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
    aiGateway.predict.mockRejectedValue(
      new ServiceUnavailableException('Risk AI model is unavailable'),
    );

    await expect(
      service.recomputeLearnerCourse('learner-1', 'course-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(persistenceService.upsertScore).not.toHaveBeenCalled();
  });

  it('limits course recompute concurrency to five learners', async () => {
    coursesRepository.findOne.mockResolvedValue({
      id: 'course-1',
      instructorId: 'instructor-1',
    });
    featureService.getActiveEnrollmentsForCourse.mockResolvedValue(
      Array.from({ length: 8 }, (_, index) => ({
        learnerId: `learner-${index + 1}`,
        courseId: 'course-1',
      })),
    );
    let active = 0;
    let maxActive = 0;
    let releaseFirstBatch!: () => void;
    const firstBatch = new Promise<void>((resolve) => {
      releaseFirstBatch = resolve;
    });
    const recomputeLearnerCourseSpy = jest
      .spyOn(service, 'recomputeLearnerCourse')
      .mockImplementation(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (active <= 5) await firstBatch;
        active -= 1;
        return {} as RiskScoreResponse;
      });

    const recomputePromise = service.recomputeCourse(
      'course-1',
      'instructor-1',
      new Date('2026-09-30T10:00:00Z'),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(recomputeLearnerCourseSpy).toHaveBeenCalledTimes(5);
    expect(maxActive).toBe(5);
    releaseFirstBatch();

    await expect(recomputePromise).resolves.toEqual({
      processed: 8,
      succeeded: 8,
      failed: 0,
    });
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
