import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  MINIO_PUBLIC_S3_CLIENT,
  MINIO_S3_CLIENT,
} from '../../../common/constants/file.constant';
import { Course } from '../../courses/entities/course.entity';
import {
  LessonImport,
  LessonImportStatus,
} from '../entities/lesson-import.entity';
import { LessonImportQueuePublisher } from './queue/lesson-import-queue.publisher';
import { LessonImportService } from './lesson-import.service';

const courseId = '0d2c39f3-c11e-4784-a9cb-f44543a8e983';
const instructorId = '34ef3507-eb04-423c-be45-e1eaa93f3541';
const importId = '4573479c-26e4-424d-9298-9dc07ea94ee8';

describe('LessonImportService', () => {
  const importsRepository = {
    findOne: jest.fn(),
    create: jest.fn((value: Partial<LessonImport>) => value),
    save: jest.fn((value: LessonImport) => Promise.resolve(value)),
  };
  const coursesRepository = { findOne: jest.fn() };
  const internalS3 = { send: jest.fn() };
  const publicS3 = new S3Client({
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test-secret' },
  });
  const publisher = { enqueue: jest.fn() };
  let service: LessonImportService;

  beforeEach(async () => {
    jest.clearAllMocks();
    coursesRepository.findOne.mockResolvedValue({ id: courseId, instructorId });
    importsRepository.findOne.mockResolvedValue(null);
    internalS3.send.mockResolvedValue({ UploadId: 'upload-id' });
    publisher.enqueue.mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      providers: [
        LessonImportService,
        {
          provide: getRepositoryToken(LessonImport),
          useValue: importsRepository,
        },
        { provide: getRepositoryToken(Course), useValue: coursesRepository },
        { provide: MINIO_S3_CLIENT, useValue: internalS3 },
        { provide: MINIO_PUBLIC_S3_CLIENT, useValue: publicS3 },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn(() => 'course-assets') },
        },
        { provide: LessonImportQueuePublisher, useValue: publisher },
      ],
    }).compile();
    service = module.get(LessonImportService);
  });

  it('creates a multipart session with signed part URLs', async () => {
    const result = await service.initiate(courseId, instructorId, {
      fileName: 'lessons.zip',
      fileSize: 40 * 1024 * 1024,
    });
    expect(internalS3.send.mock.calls[0][0]).toBeInstanceOf(
      CreateMultipartUploadCommand,
    );
    expect(result.parts).toHaveLength(2);
    expect(result.parts[0].url).toContain('uploadId=upload-id');
    expect(importsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId,
        instructorId,
        expectedPartCount: 2,
        status: LessonImportStatus.UPLOADING,
      }),
    );
  });

  it('creates a RAR multipart session with the RAR content type', async () => {
    await service.initiate(courseId, instructorId, {
      fileName: 'lessons.rar',
      fileSize: 1024,
    });

    expect(internalS3.send.mock.calls[0][0]).toMatchObject({
      input: { ContentType: 'application/vnd.rar' },
    });
  });

  it('rejects a second active import for the same course', async () => {
    importsRepository.findOne.mockResolvedValue({
      id: importId,
      status: LessonImportStatus.PROCESSING,
    });

    await expect(
      service.initiate(courseId, instructorId, {
        fileName: 'lessons.zip',
        fileSize: 1024,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(internalS3.send).not.toHaveBeenCalled();
  });

  it('completes verified parts and queues background processing', async () => {
    const lessonImport = Object.assign(new LessonImport(), {
      id: importId,
      courseId,
      instructorId,
      sourceObjectKey: `lesson-imports/${importId}/source/lessons.zip`,
      multipartUploadId: 'upload-id',
      expectedPartCount: 1,
      declaredSize: 1024,
      status: LessonImportStatus.UPLOADING,
      progress: 0,
      errorDetails: [],
      createdLessonCount: 0,
      firstPosition: null,
      lastPosition: null,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      completedAt: null,
    });
    importsRepository.findOne.mockResolvedValue(lessonImport);
    internalS3.send.mockImplementation((command: object) => {
      if (command instanceof ListPartsCommand) {
        return Promise.resolve({
          Parts: [{ PartNumber: 1, Size: 1024, ETag: 'etag' }],
        });
      }
      if (command instanceof CompleteMultipartUploadCommand)
        return Promise.resolve({});
      if (command instanceof HeadObjectCommand)
        return Promise.resolve({ ContentLength: 1024 });
      return Promise.reject(new Error('Unexpected command'));
    });
    const result = await service.complete(courseId, importId, instructorId);
    expect(result.status).toBe(LessonImportStatus.QUEUED);
    expect(publisher.enqueue).toHaveBeenCalledWith({ importId });
  });

  it('rejects completion when a part size is invalid', async () => {
    importsRepository.findOne.mockResolvedValue(
      Object.assign(new LessonImport(), {
        id: importId,
        courseId,
        instructorId,
        sourceObjectKey: 'source.zip',
        multipartUploadId: 'upload-id',
        expectedPartCount: 1,
        declaredSize: 1024,
        status: LessonImportStatus.UPLOADING,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    internalS3.send.mockResolvedValue({
      Parts: [{ PartNumber: 1, Size: 512, ETag: 'etag' }],
    });
    await expect(
      service.complete(courseId, importId, instructorId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(publisher.enqueue).not.toHaveBeenCalled();
  });
});
