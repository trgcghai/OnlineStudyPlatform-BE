import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Client as MinioClient } from 'minio';
import { Repository } from 'typeorm';
import { MINIO_CLIENT } from '../../../common/constants/file.constant';
import { Course } from '../entities/course.entity';
import { CourseAssetCleanupMessage } from './queue/course-asset-cleanup-queue.constants';

const MINIO_DELETE_BATCH_SIZE = 1_000;

@Injectable()
export class CourseAssetCleanupService {
  constructor(
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    @Inject(MINIO_CLIENT) private readonly minioClient: MinioClient,
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
      index += MINIO_DELETE_BATCH_SIZE
    ) {
      await this.minioClient.removeObjects(
        bucket,
        uniqueKeys.slice(index, index + MINIO_DELETE_BATCH_SIZE),
      );
    }
  }
}
