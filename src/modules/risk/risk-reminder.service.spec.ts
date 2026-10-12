import { Test } from '@nestjs/testing';
import { NotificationsQueueService } from '../notifications/notifications-queue.service';
import { RiskBand, RiskScoreResponse } from './dto/risk.dto';
import { RiskReminderService } from './risk-reminder.service';

describe('RiskReminderService', () => {
  let service: RiskReminderService;
  let notificationsQueueService: { enqueueCreateNotification: jest.Mock };

  const highRiskScore: RiskScoreResponse = {
    learnerId: '11111111-1111-4111-8111-111111111111',
    courseId: '22222222-2222-4222-8222-222222222222',
    enrollmentId: '33333333-3333-4333-8333-333333333333',
    calculatedAt: new Date('2026-10-12T02:00:00Z'),
    score: 82.4,
    band: RiskBand.HIGH,
    featureVersion: 'dropout_features_v1',
    scoringVersion: 'dropout-xgb-v1',
    source: 'ai',
    features: {
      lastActivityDays: 6,
      activityCount7d: 1,
      expectedProgressGap: 24,
      courseProgressPercent: 36,
      quizScoreAvgPercent: 58,
      quizPassRate: 0.5,
      watchRatioAvg: 0.35,
      abandonedAttemptCount: 1,
      lateQuizCount: 0,
      completionVelocity: 0.1,
      totalWatchedSeconds: 1200,
      pauseCount: 3,
    },
    factors: [
      {
        key: 'expectedProgressGap',
        label: 'Tiến độ chậm hơn dự kiến',
        contribution: 28,
        value: 24,
      },
      {
        key: 'lastActivityDays',
        label: 'Lâu chưa hoạt động',
        contribution: 15,
        value: 6,
      },
    ],
  };

  beforeEach(async () => {
    notificationsQueueService = {
      enqueueCreateNotification: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RiskReminderService,
        {
          provide: NotificationsQueueService,
          useValue: notificationsQueueService,
        },
      ],
    }).compile();

    service = moduleRef.get(RiskReminderService);
  });

  it('skips auto reminders for non-high risk scores', () => {
    service.enqueueAutoReminderIfNeeded({
      ...highRiskScore,
      score: 45,
      band: RiskBand.MEDIUM,
    });

    expect(
      notificationsQueueService.enqueueCreateNotification,
    ).not.toHaveBeenCalled();
  });

  it('enqueues one auto reminder with stable daily dedupe fields for high risk scores', () => {
    service.enqueueAutoReminderIfNeeded(highRiskScore);

    expect(
      notificationsQueueService.enqueueCreateNotification,
    ).toHaveBeenCalledWith({
      kind: 'direct',
      targetUserId: highRiskScore.learnerId,
      title: 'Nhắc nhở học tập thông minh',
      message:
        'Tiến độ hiện tại của bạn là 36%. Bạn đang chậm hơn kế hoạch khoảng 24%. Yếu tố cần chú ý: Tiến độ chậm hơn dự kiến. Hãy quay lại học để bắt kịp lộ trình.',
      actionUrl: `/learner/courses/${highRiskScore.courseId}/learn`,
      metadata: {
        courseId: highRiskScore.courseId,
        learnerId: highRiskScore.learnerId,
        enrollmentId: highRiskScore.enrollmentId,
        riskScore: 82.4,
        riskBand: RiskBand.HIGH,
        progressPercent: 36,
        expectedProgressGap: 24,
        topRiskFactor: 'Tiến độ chậm hơn dự kiến',
        trigger: 'auto-risk',
      },
      triggerKey: `smart-reminder:auto-risk:${highRiskScore.courseId}:${highRiskScore.learnerId}`,
      triggerDate: '2026-10-12',
    });
  });

  it('uses a unique trigger key for every manual reminder', () => {
    service.enqueueManualReminder(highRiskScore);
    service.enqueueManualReminder(highRiskScore);

    const firstCall =
      notificationsQueueService.enqueueCreateNotification.mock.calls[0][0];
    const secondCall =
      notificationsQueueService.enqueueCreateNotification.mock.calls[1][0];
    expect(firstCall.triggerKey).toMatch(
      new RegExp(
        `^smart-reminder:manual:${highRiskScore.courseId}:${highRiskScore.learnerId}:`,
      ),
    );
    expect(secondCall.triggerKey).toMatch(
      new RegExp(
        `^smart-reminder:manual:${highRiskScore.courseId}:${highRiskScore.learnerId}:`,
      ),
    );
    expect(firstCall.triggerKey).not.toBe(secondCall.triggerKey);
    expect(firstCall.metadata.trigger).toBe('manual');
    expect(secondCall.metadata.trigger).toBe('manual');
  });
});
