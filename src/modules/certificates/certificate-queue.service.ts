import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  CERTIFICATE_JOB,
  CERTIFICATE_QUEUE,
  CertificateJobData,
} from './certificate.constants';

@Injectable()
export class CertificateQueueService {
  private readonly logger = new Logger(CertificateQueueService.name);

  constructor(
    @InjectQueue(CERTIFICATE_QUEUE)
    private readonly queue: Queue<CertificateJobData>,
  ) {}

  async enqueue(learnerId: string, courseId: string): Promise<void> {
    await this.queue.add(
      CERTIFICATE_JOB,
      { learnerId, courseId },
      {
        jobId: `certificate-${learnerId}-${courseId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async enqueueCompletion(learnerId: string, courseId: string): Promise<void> {
    try {
      await this.enqueue(learnerId, courseId);
    } catch (error) {
      // Persisted completion is recovered by the reconciliation job.
      this.logger.error(
        'Could not enqueue certificate; reconciliation will retry',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
