import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Certificate } from './entities/certificate.entity';
import { CertificateQueueService } from './certificate-queue.service';

@Injectable()
export class CertificateReconciliationService {
  private readonly logger = new Logger(CertificateReconciliationService.name);
  private cursor: string | null = null;

  constructor(
    @InjectRepository(Enrollment)
    private readonly enrollments: Repository<Enrollment>,
    private readonly queue: CertificateQueueService,
  ) {}

  @Cron('0 */5 * * * *', { waitForCompletion: true })
  async reconcile(): Promise<void> {
    try {
      const query = this.enrollments
        .createQueryBuilder('enrollment')
        .leftJoin(
          Certificate,
          'certificate',
          'certificate.learner_id = enrollment.learner_id AND certificate.course_id = enrollment.course_id',
        )
        .where(
          'enrollment.progress = 100 AND enrollment.completed_at IS NOT NULL',
        )
        .andWhere('certificate.id IS NULL')
        .orderBy('enrollment.id', 'ASC')
        .take(100);
      if (this.cursor)
        query.andWhere('enrollment.id > :cursor', { cursor: this.cursor });
      const enrollments = await query.getMany();
      for (const enrollment of enrollments)
        await this.queue.enqueue(enrollment.learnerId, enrollment.courseId);
      this.cursor = enrollments.length === 100 ? enrollments[99].id : null;
    } catch (error) {
      this.logger.error(
        'Certificate reconciliation failed; next run will retry',
        error,
      );
    }
  }
}
