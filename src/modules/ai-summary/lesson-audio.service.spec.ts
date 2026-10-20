import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { LessonAudioService } from './lesson-audio.service';

describe('LessonAudioService', () => {
  const bucket = 'course-assets';
  let s3Client: { send: jest.Mock };
  let service: LessonAudioService;

  beforeEach(() => {
    s3Client = {
      send: jest.fn().mockImplementation((command) => {
        if (command instanceof GetObjectCommand)
          return Promise.resolve({
            Body: Readable.from([Buffer.from('video')]),
          });
        return Promise.resolve({});
      }),
    };
    service = new LessonAudioService(
      s3Client as unknown as S3Client,
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
    const put = s3Client.send.mock.calls
      .map(([command]) => command)
      .find((command) => command instanceof PutObjectCommand);
    expect(put?.input).toMatchObject({
      Bucket: bucket,
      Key: result.objectKey,
      Body: expect.anything(),
      ContentLength: Buffer.byteLength('derived-audio'),
      ContentType: 'audio/ogg',
    });
  });

  it('streams a legacy MinIO video into the same audio pipeline', async () => {
    const result = await service.extractStoredVideo(
      `http://localhost:9000/${bucket}/courses/course-1/video.mp4`,
      'course-1',
      'lesson-1',
    );

    expect(s3Client.send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
    expect(s3Client.send.mock.calls[0][0].input).toEqual({
      Bucket: bucket,
      Key: 'courses/course-1/video.mp4',
    });
    expect(result.url).toContain('/summary-audio/');
  });

  it('removes a derived object by URL without exposing host assumptions', async () => {
    await service.removeAudioQuietly(
      `http://public.example/${bucket}/courses/course-1/audio.ogg`,
    );

    expect(s3Client.send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
    expect(s3Client.send.mock.calls[0][0].input).toEqual({
      Bucket: bucket,
      Key: 'courses/course-1/audio.ogg',
    });
  });
});
