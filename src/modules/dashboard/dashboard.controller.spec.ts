import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_METADATA } from '../redis/redis.constants';
import { DashboardController } from './dashboard.controller';
import { LearnerDashboardService } from './learner-dashboard.service';

describe('DashboardController', () => {
  let controller: DashboardController;
  let learnerDashboardService: { getDashboard: jest.Mock };

  const handlerOf = (methodName: keyof DashboardController) =>
    Object.getOwnPropertyDescriptor(DashboardController.prototype, methodName)!
      .value;

  beforeEach(async () => {
    learnerDashboardService = {
      getDashboard: jest.fn().mockResolvedValue({
        summary: {
          enrolledCourseCount: 0,
          completedCourseCount: 0,
          averageProgressPercent: 0,
          averageQuizScorePercent: null,
        },
        courses: [],
        recentActivities: [],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        {
          provide: LearnerDashboardService,
          useValue: learnerDashboardService,
        },
      ],
    }).compile();

    controller = module.get(DashboardController);
  });

  it('delegates learner dashboard loading to the learner dashboard service', async () => {
    const result = await controller.getLearnerDashboard('learner-id');

    expect(learnerDashboardService.getDashboard).toHaveBeenCalledWith(
      'learner-id',
    );
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
  });

  it('caches learner dashboard per user with a short TTL', () => {
    expect(
      Reflect.getMetadata(CACHE_METADATA, handlerOf('getLearnerDashboard')),
    ).toEqual({
      namespace: 'dashboard:learner',
      ttl: 30,
      scope: 'user',
    });
  });
});
