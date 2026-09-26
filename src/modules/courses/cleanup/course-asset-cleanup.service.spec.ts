import { ConfigService } from '@nestjs/config';
import type { Client as MinioClient } from 'minio';
import { Repository } from 'typeorm';
import { Course } from '../entities/course.entity';
import { CourseAssetCleanupService } from './course-asset-cleanup.service';

describe('CourseAssetCleanupService', () => {
  const courseId = '33333333-3333-4333-8333-333333333333';
  let coursesRepository: { exists: jest.Mock };
  let minioClient: { removeObjects: jest.Mock };
  let service: CourseAssetCleanupService;

  beforeEach(() => {
    coursesRepository = {
      exists: jest.fn().mockResolvedValue(false),
    };
    minioClient = {
      removeObjects: jest.fn().mockResolvedValue(undefined),
    };
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('lms-bucket'),
    };

    service = new CourseAssetCleanupService(
      coursesRepository as unknown as Repository<Course>,
      minioClient as unknown as MinioClient,
      configService as unknown as ConfigService,
    );
  });

  it('deletes unique object keys after the course no longer exists', async () => {
    await service.cleanup({
      courseId,
      objectKeys: ['courses/course/video.mp4', 'courses/course/video.mp4'],
    });

    expect(coursesRepository.exists).toHaveBeenCalledWith({
      where: { id: courseId },
    });
    expect(minioClient.removeObjects).toHaveBeenCalledWith('lms-bucket', [
      'courses/course/video.mp4',
    ]);
  });

  it('does not delete files while the course still exists', async () => {
    coursesRepository.exists.mockResolvedValue(true);

    await expect(
      service.cleanup({
        courseId,
        objectKeys: ['courses/course/video.mp4'],
      }),
    ).rejects.toThrow(`Course ${courseId} still exists`);

    expect(minioClient.removeObjects).not.toHaveBeenCalled();
  });

  it('deletes large cleanup jobs in MinIO batches', async () => {
    const objectKeys = Array.from(
      { length: 1_001 },
      (_, index) => `courses/course/video-${index}.mp4`,
    );

    await service.cleanup({ courseId, objectKeys });

    expect(minioClient.removeObjects).toHaveBeenCalledTimes(2);
    expect(minioClient.removeObjects.mock.calls[0][1]).toHaveLength(1_000);
    expect(minioClient.removeObjects.mock.calls[1][1]).toHaveLength(1);
  });

  it('propagates MinIO failures so RabbitMQ can retry the cleanup', async () => {
    minioClient.removeObjects.mockRejectedValue(new Error('minio down'));

    await expect(
      service.cleanup({
        courseId,
        objectKeys: ['courses/course/video.mp4'],
      }),
    ).rejects.toThrow('minio down');
  });
});
