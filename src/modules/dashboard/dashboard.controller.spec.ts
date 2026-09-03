import { Test, TestingModule } from '@nestjs/testing';
import { DashboardController } from './dashboard.controller';
import { LearnerDashboardService } from './learner-dashboard.service';

describe('DashboardController', () => {
  let controller: DashboardController;
  let learnerDashboardService: { getDashboard: jest.Mock };

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
});
