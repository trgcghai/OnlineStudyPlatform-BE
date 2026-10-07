import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Certificate } from './entities/certificate.entity';
import { CERTIFICATE_QUEUE } from './certificate.constants';
import { CertificateQueueService } from './certificate-queue.service';
import { CertificateEligibilityService } from './certificate-eligibility.service';
import { CertificatePdfService } from './certificate-pdf.service';
import { CertificateStorageService } from './certificate-storage.service';
import { CertificatesService } from './certificates.service';
import {
  CertificatesController,
  CertificateVerificationController,
} from './certificates.controller';
import { CertificateProcessor } from './certificate-processor';
import { CertificateReconciliationService } from './certificate-reconciliation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Certificate, Enrollment]),
    BullModule.registerQueue({ name: CERTIFICATE_QUEUE }),
  ],
  providers: [
    CertificateQueueService,
    CertificateEligibilityService,
    CertificatePdfService,
    CertificateStorageService,
    CertificatesService,
    CertificateProcessor,
    CertificateReconciliationService,
  ],
  controllers: [CertificatesController, CertificateVerificationController],
  exports: [CertificateQueueService],
})
export class CertificatesModule {}
