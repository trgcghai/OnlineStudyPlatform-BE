import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { QuizAttemptStatus } from './dto/quiz-attempt.dto';
import { QuizAttempt } from './entities/quiz-attempt.entity';

@Injectable()
export class QuizAttemptCleanupService {
  private readonly logger = new Logger(QuizAttemptCleanupService.name);

  constructor(
    @InjectRepository(QuizAttempt)
    private readonly attemptsRepository: Repository<QuizAttempt>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runCleanup(now: Date = new Date()): Promise<void> {
    const result = await this.attemptsRepository.update(
      {
        status: QuizAttemptStatus.IN_PROGRESS,
        expiresAt: LessThanOrEqual(now),
      },
      { status: QuizAttemptStatus.ABANDONED },
    );

    this.logger.log(
      `Marked ${result.affected ?? 0} expired quiz attempts as abandoned`,
    );
  }
}
