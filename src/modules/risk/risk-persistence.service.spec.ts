import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { RiskBand, RiskScoreResponse } from './dto/risk.dto';
import { RiskPersistenceService } from './risk-persistence.service';
import { RiskScore } from './schemas/risk-score.schema';

describe('RiskPersistenceService', () => {
  let service: RiskPersistenceService;
  let model: {
    findOneAndUpdate: jest.Mock;
    aggregate: jest.Mock;
    find: jest.Mock;
  };

  const score: RiskScoreResponse = {
    learnerId: 'learner-1',
    courseId: 'course-1',
    enrollmentId: 'enrollment-1',
    calculatedAt: new Date('2026-09-30T00:00:00Z'),
    score: 75,
    band: RiskBand.HIGH,
    featureVersion: 'dropout_features_v1',
    scoringVersion: 'heuristic-risk-v1',
    source: 'heuristic',
    features: {
      lastActivityDays: 5,
      activityCount7d: 0,
      expectedProgressGap: 30,
      courseProgressPercent: 10,
      quizScoreAvgPercent: 40,
      quizPassRate: 0,
      watchRatioAvg: 0.2,
      abandonedAttemptCount: 1,
      lateQuizCount: 1,
      completionVelocity: 0,
      totalWatchedSeconds: 0,
      pauseCount: 2,
    },
    factors: [],
  };

  beforeEach(async () => {
    model = {
      findOneAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(score),
      }),
      aggregate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([score]),
      }),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([score]),
        }),
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RiskPersistenceService,
        { provide: getModelToken(RiskScore.name), useValue: model },
      ],
    }).compile();

    service = moduleRef.get(RiskPersistenceService);
  });

  it('upserts by jobKey for idempotent recompute', async () => {
    await service.upsertScore('risk:course-1:learner-1:2026-09-30', score);

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { jobKey: 'risk:course-1:learner-1:2026-09-30' },
      { $set: { ...score, jobKey: 'risk:course-1:learner-1:2026-09-30' } },
      { new: true, upsert: true },
    );
  });

  it('loads latest scores with threshold and band filters', async () => {
    await service.findLatestByCourse('course-1', {
      threshold: 70,
      band: RiskBand.HIGH,
    });

    expect(model.aggregate).toHaveBeenCalled();
    const pipeline = model.aggregate.mock.calls[0][0];
    expect(pipeline).toEqual(
      expect.arrayContaining([
        { $match: { courseId: 'course-1' } },
        { $match: { score: { $gte: 70 }, band: RiskBand.HIGH } },
      ]),
    );
  });
});
