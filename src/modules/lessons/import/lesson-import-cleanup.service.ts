import { AbortMultipartUploadCommand, S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { MINIO_S3_CLIENT } from '../../../common/constants/file.constant';
import {
  LessonImport,
  LessonImportStatus,
} from '../entities/lesson-import.entity';

@Injectable()
export class LessonImportCleanupService {
  private readonly logger = new Logger(LessonImportCleanupService.name);

  constructor(
    @InjectRepository(LessonImport)
    private readonly importsRepository: Repository<LessonImport>,
    @Inject(MINIO_S3_CLIENT) private readonly s3Client: S3Client,
    private readonly configService: ConfigService,
  ) {}

  @Cron('0 * * * *')
  async abortExpiredUploads(): Promise<void> {
    const expired = await this.importsRepository.find({
      where: {
        status: LessonImportStatus.UPLOADING,
        expiresAt: LessThan(new Date()),
      },
      take: 100,
    });
    for (const item of expired) {
      try {
        await this.s3Client.send(
          new AbortMultipartUploadCommand({
            Bucket: this.configService.getOrThrow<string>('MINIO_BUCKET'),
            Key: item.sourceObjectKey,
            UploadId: item.multipartUploadId,
          }),
        );
      } catch (error) {
        this.logger.warn(
          `Could not abort expired import ${item.id}: ${String(error)}`,
        );
      }
      await this.importsRepository.update(item.id, {
        status: LessonImportStatus.ABORTED,
        errorDetails: ['Upload session expired'],
      });
    }
  }
}
