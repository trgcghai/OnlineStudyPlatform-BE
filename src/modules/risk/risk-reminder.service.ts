import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { NotificationsQueueService } from '../notifications/notifications-queue.service';
import {
  SMART_REMINDER_ACTION_URL_PREFIX,
  SMART_REMINDER_TRIGGER_AUTO,
  SMART_REMINDER_TRIGGER_MANUAL,
} from './constants/risk.constants';
import { RiskBand, RiskScoreResponse } from './dto/risk.dto';

type SmartReminderTrigger = 'auto-risk' | 'manual';

@Injectable()
export class RiskReminderService {
  constructor(
    private readonly notificationsQueueService: NotificationsQueueService,
  ) {}

  enqueueAutoReminderIfNeeded(score: RiskScoreResponse): void {
    if (score.band !== RiskBand.HIGH) return;

    this.notificationsQueueService.enqueueCreateNotification({
      ...this.buildMessage(score, 'auto-risk'),
      triggerKey: `${SMART_REMINDER_TRIGGER_AUTO}:${score.courseId}:${score.learnerId}`,
      triggerDate: this.toDateKey(score.calculatedAt),
    });
  }

  enqueueManualReminder(score: RiskScoreResponse, now = new Date()): void {
    this.notificationsQueueService.enqueueCreateNotification({
      ...this.buildMessage(score, 'manual'),
      triggerKey: `${SMART_REMINDER_TRIGGER_MANUAL}:${score.courseId}:${score.learnerId}:${randomUUID()}`,
      triggerDate: this.toDateKey(now),
    });
  }

  private buildMessage(
    score: RiskScoreResponse,
    trigger: SmartReminderTrigger,
  ) {
    const progressPercent = this.roundPercent(
      score.features.courseProgressPercent,
    );
    const expectedProgressGap = this.roundPercent(
      score.features.expectedProgressGap,
    );
    const topRiskFactor = this.getTopRiskFactorLabel(score);

    return {
      kind: 'direct' as const,
      targetUserId: score.learnerId,
      title: 'Nhắc nhở học tập thông minh',
      message: this.buildReminderMessage(
        progressPercent,
        expectedProgressGap,
        topRiskFactor,
      ),
      actionUrl: `${SMART_REMINDER_ACTION_URL_PREFIX}/${score.courseId}/learn`,
      metadata: {
        courseId: score.courseId,
        learnerId: score.learnerId,
        enrollmentId: score.enrollmentId,
        riskScore: score.score,
        riskBand: score.band,
        progressPercent,
        expectedProgressGap,
        topRiskFactor,
        trigger,
      },
    };
  }

  private buildReminderMessage(
    progressPercent: number,
    expectedProgressGap: number,
    topRiskFactor: string,
  ): string {
    return `Tiến độ hiện tại của bạn là ${progressPercent}%. Bạn đang chậm hơn kế hoạch khoảng ${expectedProgressGap}%. Yếu tố cần chú ý: ${topRiskFactor}. Hãy quay lại học để bắt kịp lộ trình.`;
  }

  private getTopRiskFactorLabel(score: RiskScoreResponse): string {
    const topFactor = [...score.factors].sort(
      (a, b) => b.contribution - a.contribution,
    )[0];
    return topFactor?.label ?? 'tiến độ học tập cần được cải thiện';
  }

  private roundPercent(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private toDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
