import {
  Injectable,
  Logger,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { Certificate } from './entities/certificate.entity';
import { CertificateEligibilityService } from './certificate-eligibility.service';
import { CertificatePdfService } from './certificate-pdf.service';
import { CertificateStorageService } from './certificate-storage.service';

export function certificateSummary(certificate: Certificate) {
  return {
    id: certificate.id,
    courseId: certificate.courseId,
    learnerName: certificate.learnerName,
    courseTitle: certificate.courseTitle,
    issuedAt: certificate.issuedAt,
    certificateUrl: certificate.certificateUrl,
    verificationUrl: `/certificates/${certificate.id}/verify`,
  };
}

@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);

  constructor(
    @InjectRepository(Certificate)
    private readonly repository: Repository<Certificate>,
    private readonly dataSource: DataSource,
    private readonly eligibility: CertificateEligibilityService,
    private readonly pdf: CertificatePdfService,
    private readonly storage: CertificateStorageService,
  ) {}

  async issue(
    learnerId: string,
    courseId: string,
  ): Promise<Certificate | null> {
    let uploadedKey: string | undefined;
    let inserted = false;
    try {
      return await this.dataSource.transaction(async (manager) => {
        // Serialize workers and retries for this learner-course across instances.
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
          [learnerId, courseId],
        );
        const certificates = manager.getRepository(Certificate);
        const existing = await certificates.findOne({
          where: { learnerId, courseId },
        });
        if (existing) return existing;
        const enrollment = await this.eligibility.getEligibleEnrollment(
          manager,
          learnerId,
          courseId,
        );
        if (!enrollment) return null;
        const id = randomUUID();
        const certificate = certificates.create({
          id,
          learnerId,
          courseId,
          issuedAt: new Date(),
          certificateUrl: `/learner/certificates/${id}/download`,
          objectKey: `certificates/${id}.pdf`,
          learnerName: enrollment.learner.name,
          courseTitle: enrollment.course.title,
        });
        const bytes = await this.pdf.generate(certificate);
        await this.storage.upload(certificate.objectKey, bytes);
        uploadedKey = certificate.objectKey;
        const saved = await certificates.save(certificate);
        inserted = true;
        return saved;
      });
    } catch (error) {
      // A lost COMMIT response can mean the row committed successfully.
      // Preserve its PDF rather than deleting a potentially issued certificate.
      if (uploadedKey && !inserted) {
        try {
          await this.storage.remove(uploadedKey);
        } catch (cleanupError) {
          this.logger.error(
            'Could not clean up unissued certificate PDF',
            cleanupError,
          );
        }
      }
      throw error;
    }
  }

  async list(learnerId: string) {
    const certificates = await this.repository.find({
      where: { learnerId },
      order: { issuedAt: 'DESC', id: 'ASC' },
    });
    return certificates.map(certificateSummary);
  }

  async verify(id: string) {
    const certificate = await this.repository.findOne({ where: { id } });
    if (!certificate) throw new NotFoundException('Không tìm thấy chứng chỉ.');
    return {
      valid: true,
      id: certificate.id,
      learnerName: certificate.learnerName,
      courseTitle: certificate.courseTitle,
      issuedAt: certificate.issuedAt,
    };
  }

  async download(learnerId: string, id: string): Promise<StreamableFile> {
    const certificate = await this.repository.findOne({
      where: { id, learnerId },
    });
    if (!certificate) throw new NotFoundException('Không tìm thấy chứng chỉ.');
    const stream = await this.storage.download(certificate.objectKey);
    return new StreamableFile(stream, {
      type: 'application/pdf',
      disposition: `attachment; filename="certificate-${certificate.id}.pdf"`,
    });
  }
}
