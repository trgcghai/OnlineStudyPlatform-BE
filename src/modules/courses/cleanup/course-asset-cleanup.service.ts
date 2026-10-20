import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MINIO_S3_CLIENT } from '../../../common/constants/file.constant';
import { Course } from '../entities/course.entity';
import { CourseAssetCleanupMessage } from './queue/course-asset-cleanup-queue.constants';

const S3_DELETE_BATCH_SIZE = 1_000;

@Injectable()
export class CourseAssetCleanupService {
  constructor(
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    @Inject(MINIO_S3_CLIENT) private readonly s3Client: S3Client,
    private readonly configService: ConfigService,
  ) {}

  async cleanup(message: CourseAssetCleanupMessage): Promise<void> {
    const courseStillExists = await this.coursesRepository.exists({
      where: { id: message.courseId },
    });

    if (courseStillExists) {
      throw new Error(`Course ${message.courseId} still exists`);
    }

    const bucket = this.configService.getOrThrow<string>('MINIO_BUCKET');
    const uniqueKeys = [...new Set(message.objectKeys)];

    for (
      let index = 0;
      index < uniqueKeys.length;
      index += S3_DELETE_BATCH_SIZE
    ) {
      const result = await this.s3Client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: uniqueKeys
              .slice(index, index + S3_DELETE_BATCH_SIZE)
              .map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
      if (result.Errors?.length) {
        throw new Error(
          `S3 failed to delete ${result.Errors.length} course asset${result.Errors.length === 1 ? '' : 's'}`,
        );
      }
    }
  }
}
