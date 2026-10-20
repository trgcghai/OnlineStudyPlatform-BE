import { ConfigService } from '@nestjs/config';
import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { Repository } from 'typeorm';
import { Course } from '../entities/course.entity';
import { CourseAssetCleanupService } from './course-asset-cleanup.service';

describe('CourseAssetCleanupService', () => {
  const courseId = '33333333-3333-4333-8333-333333333333';
  let coursesRepository: { exists: jest.Mock };
  let s3Client: { send: jest.Mock };
  let service: CourseAssetCleanupService;

  beforeEach(() => {
    coursesRepository = {
      exists: jest.fn().mockResolvedValue(false),
    };
    s3Client = { send: jest.fn().mockResolvedValue({}) };
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('lms-bucket'),
    };

    service = new CourseAssetCleanupService(
      coursesRepository as unknown as Repository<Course>,
      s3Client as unknown as S3Client,
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
    expect(s3Client.send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectsCommand);
    expect(s3Client.send.mock.calls[0][0].input).toMatchObject({
      Bucket: 'lms-bucket',
      Delete: { Objects: [{ Key: 'courses/course/video.mp4' }], Quiet: true },
    });
  });

  it('does not delete files while the course still exists', async () => {
    coursesRepository.exists.mockResolvedValue(true);

    await expect(
      service.cleanup({
        courseId,
        objectKeys: ['courses/course/video.mp4'],
      }),
    ).rejects.toThrow(`Course ${courseId} still exists`);

    expect(s3Client.send).not.toHaveBeenCalled();
  });

  it('deletes large cleanup jobs in S3 batches', async () => {
    const objectKeys = Array.from(
      { length: 1_001 },
      (_, index) => `courses/course/video-${index}.mp4`,
    );

    await service.cleanup({ courseId, objectKeys });

    expect(s3Client.send).toHaveBeenCalledTimes(2);
    expect(s3Client.send.mock.calls[0][0].input.Delete.Objects).toHaveLength(
      1_000,
    );
    expect(s3Client.send.mock.calls[1][0].input.Delete.Objects).toHaveLength(1);
  });

  it('propagates S3 failures so RabbitMQ can retry the cleanup', async () => {
    s3Client.send.mockRejectedValue(new Error('s3 down'));

    await expect(
      service.cleanup({
        courseId,
        objectKeys: ['courses/course/video.mp4'],
      }),
    ).rejects.toThrow('s3 down');
  });

  it('propagates per-object deletion failures returned by S3', async () => {
    s3Client.send.mockResolvedValueOnce({
      Errors: [{ Key: 'courses/course/video.mp4', Code: 'AccessDenied' }],
    });

    await expect(
      service.cleanup({
        courseId,
        objectKeys: ['courses/course/video.mp4'],
      }),
    ).rejects.toThrow('S3 failed to delete 1 course asset');
  });
});
