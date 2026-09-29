import { ConfigService } from '@nestjs/config';
import { writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { Client as MinioClient } from 'minio';
import { LessonAudioService } from './lesson-audio.service';

describe('LessonAudioService', () => {
  const bucket = 'course-assets';
  let minioClient: {
    putObject: jest.Mock;
    getObject: jest.Mock;
    removeObject: jest.Mock;
  };
  let service: LessonAudioService;

  beforeEach(() => {
    minioClient = {
      putObject: jest.fn().mockResolvedValue(undefined),
      getObject: jest
        .fn()
        .mockResolvedValue(Readable.from([Buffer.from('video')])),
      removeObject: jest.fn().mockResolvedValue(undefined),
    };
    service = new LessonAudioService(
      minioClient as unknown as MinioClient,
      {
        get: jest.fn(),
        getOrThrow: jest.fn((key: string) => {
          if (key === 'MINIO_BUCKET') return bucket;
          if (key === 'MINIO_ENDPOINT') return 'http://minio:9000';
          throw new Error(`Unexpected config ${key}`);
        }),
      } as unknown as ConfigService,
    );
    const internals = service as unknown as {
      runFfmpeg(inputPath: string, outputPath: string): Promise<void>;
    };
    jest
      .spyOn(internals, 'runFfmpeg')
      .mockImplementation((_inputPath, outputPath) =>
        writeFile(outputPath, Buffer.from('derived-audio')),
      );
  });

  it('extracts Opus audio and uploads only the derived object', async () => {
    const result = await service.extractAndUpload(
      Buffer.from('video'),
      'lecture.mp4',
      'courses/course-1/lessons/lesson-1/summary-audio',
    );

    expect(result.objectKey).toMatch(/summary-audio\/[\w-]+\.ogg$/);
    expect(result.url).toBe(`http://minio:9000/${bucket}/${result.objectKey}`);
    expect(minioClient.putObject).toHaveBeenCalledWith(
      bucket,
      result.objectKey,
      expect.anything(),
      Buffer.byteLength('derived-audio'),
      { 'Content-Type': 'audio/ogg' },
    );
  });

  it('streams a legacy MinIO video into the same audio pipeline', async () => {
    const result = await service.extractStoredVideo(
      `http://localhost:9000/${bucket}/courses/course-1/video.mp4`,
      'course-1',
      'lesson-1',
    );

    expect(minioClient.getObject).toHaveBeenCalledWith(
      bucket,
      'courses/course-1/video.mp4',
    );
    expect(result.url).toContain('/summary-audio/');
  });

  it('removes a derived object by URL without exposing host assumptions', async () => {
    await service.removeAudioQuietly(
      `http://public.example/${bucket}/courses/course-1/audio.ogg`,
    );

    expect(minioClient.removeObject).toHaveBeenCalledWith(
      bucket,
      'courses/course-1/audio.ogg',
    );
  });
});
