import { CronExpression } from '@nestjs/schedule';
import { LessThanOrEqual, Repository } from 'typeorm';
import { QuizAttemptStatus } from './dto/quiz-attempt.dto';
import { QuizAttemptCleanupService } from './quiz-attempt-cleanup.service';
import { QuizAttempt } from './entities/quiz-attempt.entity';

type CronMethod = (...args: unknown[]) => unknown;

describe('QuizAttemptCleanupService', () => {
  let service: QuizAttemptCleanupService;
  let attemptsRepository: { update: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T10:15:00.000Z'));
    attemptsRepository = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    service = new QuizAttemptCleanupService(
      attemptsRepository as unknown as Repository<QuizAttempt>,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is scheduled as a server-time midnight cron job', () => {
    const runCleanup = Object.getOwnPropertyDescriptor(
      QuizAttemptCleanupService.prototype,
      'runCleanup',
    )?.value as CronMethod;

    expect(Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', runCleanup)).toEqual({
      cronTime: CronExpression.EVERY_DAY_AT_MIDNIGHT,
    });
  });

  it('marks expired in-progress attempts as abandoned', async () => {
    await service.runCleanup();

    expect(attemptsRepository.update).toHaveBeenCalledWith(
      {
        status: QuizAttemptStatus.IN_PROGRESS,
        expiresAt: LessThanOrEqual(new Date('2026-09-01T10:15:00.000Z')),
      },
      { status: QuizAttemptStatus.ABANDONED },
    );
  });
});
