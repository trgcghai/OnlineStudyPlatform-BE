import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  CERTIFICATE_JOB,
  CERTIFICATE_QUEUE,
  CertificateJobData,
} from './certificate.constants';
import { CertificatesService } from './certificates.service';

@Processor(CERTIFICATE_QUEUE, { concurrency: 2 })
export class CertificateProcessor extends WorkerHost {
  constructor(private readonly certificates: CertificatesService) {
    super();
  }

  async process(job: Job<CertificateJobData>): Promise<void> {
    if (job.name !== CERTIFICATE_JOB)
      throw new Error(`Unknown certificate job: ${job.name}`);
    await this.certificates.issue(job.data.learnerId, job.data.courseId);
  }
}
