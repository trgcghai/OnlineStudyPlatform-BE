import { ConfigService } from '@nestjs/config';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { Course, CourseStatus } from '../../courses/entities/course.entity';
import {
  LessonImport,
  LessonImportStatus,
} from '../entities/lesson-import.entity';
import { Lesson } from '../entities/lesson.entity';
import {
  LessonImportProcessorService,
  LessonImportValidationError,
} from './lesson-import-processor.service';

const importId = '4573479c-26e4-424d-9298-9dc07ea94ee8';

describe('LessonImportProcessorService', () => {
  const importsRepository = {
    update: jest.fn(),
    findOneByOrFail: jest.fn(),
  };
  const s3Client = { send: jest.fn().mockResolvedValue({}) };
  const manager = {
    findOne: jest.fn(),
    create: jest.fn((_entity: object, value: object) => value),
    save: jest.fn(),
    update: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn((callback: (value: typeof manager) => unknown) =>
      callback(manager),
    ),
  };
  const progressService = {
    recomputeCourseEnrollmentsProgress: jest.fn(),
  };
  const zipService = {
    openLessonImport: jest.fn(),
  };
  const lessonAudioService = {
    extractAndUpload: jest.fn(),
  };
  const aiSummaryService = {
    enqueueLesson: jest.fn(),
  };
  const aiKnowledgeService = {
    enqueueMaterial: jest.fn(),
  };
  const videoMetadataService = {
    getDuration: jest.fn(),
  };
  let service: LessonImportProcessorService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LessonImportProcessorService(
      importsRepository as never,
      s3Client as never,
      {
        get: jest.fn(),
        getOrThrow: jest.fn((key: string) =>
          key === 'MINIO_BUCKET' ? 'course-assets' : 'http://localhost:9000',
        ),
      } as unknown as ConfigService,
      dataSource as never,
      progressService as never,
      zipService as never,
      lessonAudioService as never,
      aiSummaryService as never,
      aiKnowledgeService as never,
      videoMetadataService as never,
    );
  });

  it('appends imported lessons after the existing final position atomically', async () => {
    manager.findOne.mockImplementation((entity: object) =>
      Promise.resolve(
        entity === Course
          ? {
              id: 'course-id',
              instructorId: 'instructor-id',
              status: CourseStatus.DRAFT,
            }
          : { position: 3 },
      ),
    );
    manager.save.mockResolvedValue(undefined);
    manager.update.mockResolvedValue(undefined);
    const internals = service as unknown as {
      persistLessons(value: LessonImport, lessons: object[]): Promise<void>;
    };
    await internals.persistLessons(
      Object.assign(new LessonImport(), {
        id: importId,
        courseId: 'course-id',
        instructorId: 'instructor-id',
      }),
      [
        {
          id: 'lesson-1',
          row: { title: 'First', description: '' },
          duration: 0,
          videoUrl: null,
          summaryAudioUrl: null,
          materialUrl: null,
        },
        {
          id: 'lesson-2',
          row: { title: 'Second', description: '' },
          duration: 0,
          videoUrl: null,
          summaryAudioUrl: null,
          materialUrl: null,
        },
      ],
    );
    const saved = manager.save.mock.calls[0][1] as Lesson[];
    expect(saved.map((lesson) => lesson.position)).toEqual([4, 5]);
    expect(manager.update).toHaveBeenCalledWith(
      LessonImport,
      importId,
      expect.objectContaining({
        status: LessonImportStatus.COMPLETED,
        createdLessonCount: 2,
        firstPosition: 4,
        lastPosition: 5,
      }),
    );
    expect(aiSummaryService.enqueueLesson).not.toHaveBeenCalled();
  });

  it('enqueues only imported video lessons after a published course transaction commits', async () => {
    manager.findOne.mockImplementation((entity: object) =>
      Promise.resolve(
        entity === Course
          ? {
              id: 'course-id',
              instructorId: 'instructor-id',
              status: CourseStatus.PUBLISHED,
            }
          : null,
      ),
    );
    manager.save.mockResolvedValue(undefined);
    manager.update.mockResolvedValue(undefined);
    aiSummaryService.enqueueLesson.mockResolvedValue(true);
    const internals = service as unknown as {
      persistLessons(value: LessonImport, lessons: object[]): Promise<void>;
    };

    await internals.persistLessons(
      Object.assign(new LessonImport(), {
        id: importId,
        courseId: 'course-id',
        instructorId: 'instructor-id',
      }),
      [
        {
          id: 'video-lesson',
          row: { title: 'Video', description: '' },
          duration: 2165,
          videoUrl: 'http://localhost/video.mp4',
          summaryAudioUrl: 'http://localhost/audio.ogg',
          materialUrl: null,
        },
        {
          id: 'material-lesson',
          row: { title: 'Material', description: '' },
          duration: 0,
          videoUrl: null,
          summaryAudioUrl: null,
          materialUrl: 'http://localhost/material.pdf',
        },
      ],
    );

    expect(aiSummaryService.enqueueLesson).toHaveBeenCalledTimes(1);
    const savedLessons = manager.save.mock.calls[0][1] as Lesson[];
    expect(savedLessons[0].duration).toBe(2165);
    expect(savedLessons[1].duration).toBe(0);
    expect(aiSummaryService.enqueueLesson).toHaveBeenCalledWith('video-lesson');
    expect(aiKnowledgeService.enqueueMaterial).toHaveBeenCalledWith(
      'material-lesson',
    );
    expect(manager.update).toHaveBeenCalledWith(
      LessonImport,
      importId,
      expect.objectContaining({ status: LessonImportStatus.COMPLETED }),
    );
  });

  it('keeps a published lesson import completed when summary enqueue fails', async () => {
    manager.findOne.mockImplementation((entity: object) =>
      Promise.resolve(
        entity === Course
          ? {
              id: 'course-id',
              instructorId: 'instructor-id',
              status: CourseStatus.PUBLISHED,
            }
          : null,
      ),
    );
    manager.save.mockResolvedValue(undefined);
    manager.update.mockResolvedValue(undefined);
    aiSummaryService.enqueueLesson.mockRejectedValue(
      new Error('Redis unavailable'),
    );
    const internals = service as unknown as {
      persistLessons(value: LessonImport, lessons: object[]): Promise<void>;
    };

    await expect(
      internals.persistLessons(
        Object.assign(new LessonImport(), {
          id: importId,
          courseId: 'course-id',
          instructorId: 'instructor-id',
        }),
        [
          {
            id: 'video-lesson',
            row: { title: 'Video', description: '' },
            duration: 120,
            videoUrl: 'http://localhost/video.mp4',
            summaryAudioUrl: null,
            materialUrl: null,
          },
        ],
      ),
    ).resolves.toBeUndefined();
    expect(manager.update).toHaveBeenCalledWith(
      LessonImport,
      importId,
      expect.objectContaining({ status: LessonImportStatus.COMPLETED }),
    );
  });

  function arrangeVideoArchive() {
    const asset = { path: 'videos/lecture.mp4', uncompressedSize: 5 };
    const source = Readable.from(['video']);
    const archive = {
      rows: [
        {
          title: 'Imported video',
          description: '',
          videoFilename: 'lecture.mp4',
          materialFilename: null,
        },
      ],
      referencedFileCount: 1,
      getAsset: jest.fn().mockReturnValue(asset),
      openStream: jest.fn().mockResolvedValue(source),
      close: jest.fn(),
    };
    zipService.openLessonImport.mockResolvedValue(archive);
    manager.findOne.mockImplementation((entity: object) =>
      Promise.resolve(
        entity === Course
          ? { instructorId: 'instructor-id', status: CourseStatus.DRAFT }
          : null,
      ),
    );
    const internals = service as unknown as {
      importArchive(value: LessonImport, path: string): Promise<void>;
      removeAssetPrefixQuietly(value: string): Promise<void>;
      uploadReferencedEntry(): Promise<string>;
      createSummaryAudioQuietly(): Promise<string | null>;
    };
    jest.spyOn(internals, 'removeAssetPrefixQuietly').mockResolvedValue();
    const upload = jest
      .spyOn(internals, 'uploadReferencedEntry')
      .mockResolvedValue('http://localhost/video.mp4');
    jest.spyOn(internals, 'createSummaryAudioQuietly').mockResolvedValue(null);
    const lessonImport = Object.assign(new LessonImport(), {
      id: importId,
      courseId: 'course-id',
      instructorId: 'instructor-id',
    });
    return { internals, lessonImport, archive, source, upload };
  }

  it('probes an imported video before persisting its measured duration', async () => {
    const { internals, lessonImport, archive, source } = arrangeVideoArchive();
    videoMetadataService.getDuration.mockResolvedValue(2164);

    await internals.importArchive(lessonImport, 'source.zip');

    expect(videoMetadataService.getDuration).toHaveBeenCalledWith(
      source,
      'videos/lecture.mp4',
    );
    const saved = manager.save.mock.calls[0][1] as Lesson[];
    expect(saved[0]).toMatchObject({
      title: 'Imported video',
      duration: 2164,
      videoUrl: 'http://localhost/video.mp4',
    });
    expect(archive.close).toHaveBeenCalled();
  });

  it('does not upload or persist a lesson when video metadata cannot be read', async () => {
    const { internals, lessonImport, archive, upload } = arrangeVideoArchive();
    videoMetadataService.getDuration.mockRejectedValue(
      new Error('Video must have a finite, positive duration'),
    );

    await expect(
      internals.importArchive(lessonImport, 'source.zip'),
    ).rejects.toThrow('Video must have a finite, positive duration');
    expect(upload).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
    expect(archive.close).toHaveBeenCalled();
  });

  it('marks validation failures terminal and removes uploaded objects', async () => {
    const lessonImport = Object.assign(new LessonImport(), {
      id: importId,
      courseId: 'course-id',
      sourceObjectKey: 'source.zip',
    });
    importsRepository.update.mockResolvedValueOnce({ affected: 1 });
    importsRepository.findOneByOrFail.mockResolvedValue(lessonImport);
    const internals = service as unknown as {
      downloadSource(value: LessonImport, path: string): Promise<void>;
      importArchive(value: LessonImport, path: string): Promise<void>;
      removeAssetPrefixQuietly(value: string): Promise<void>;
      removeSourceQuietly(value: LessonImport): Promise<void>;
    };
    jest.spyOn(internals, 'downloadSource').mockResolvedValue();
    jest
      .spyOn(internals, 'importArchive')
      .mockRejectedValue(new LessonImportValidationError(['Missing file']));
    const cleanupAssets = jest
      .spyOn(internals, 'removeAssetPrefixQuietly')
      .mockResolvedValue();
    const cleanupSource = jest
      .spyOn(internals, 'removeSourceQuietly')
      .mockResolvedValue();

    await service.process(importId);

    expect(cleanupAssets).toHaveBeenCalledWith(importId);
    expect(cleanupSource).toHaveBeenCalledWith(lessonImport);
    expect(importsRepository.update).toHaveBeenCalledWith(
      importId,
      expect.objectContaining({
        status: LessonImportStatus.FAILED,
        errorDetails: ['Missing file'],
      }),
    );
  });

  it('returns transient failures to queued state for RabbitMQ retry', async () => {
    const lessonImport = Object.assign(new LessonImport(), {
      id: importId,
      courseId: 'course-id',
      sourceObjectKey: 'source.zip',
    });
    importsRepository.update.mockResolvedValueOnce({ affected: 1 });
    importsRepository.findOneByOrFail.mockResolvedValue(lessonImport);
    const internals = service as unknown as {
      downloadSource(value: LessonImport, path: string): Promise<void>;
      removeAssetPrefixQuietly(value: string): Promise<void>;
    };
    jest
      .spyOn(internals, 'downloadSource')
      .mockRejectedValue(new Error('MinIO unavailable'));
    jest.spyOn(internals, 'removeAssetPrefixQuietly').mockResolvedValue();

    await expect(service.process(importId)).rejects.toThrow(
      'MinIO unavailable',
    );
    expect(importsRepository.update).toHaveBeenCalledWith(importId, {
      status: LessonImportStatus.QUEUED,
      progress: 35,
    });
  });

  it('paginates prefix cleanup and deletes objects in batches of 1,000', async () => {
    const keys = Array.from({ length: 1_003 }, (_, index) => ({
      Key: `lesson-imports/${importId}/assets/${index}`,
    }));
    s3Client.send
      .mockResolvedValueOnce({
        Contents: keys.slice(0, 1_000),
        IsTruncated: true,
        NextContinuationToken: 'next-page',
      })
      .mockResolvedValueOnce({
        Contents: keys.slice(1_000),
        IsTruncated: false,
      })
      .mockResolvedValue({});
    const internals = service as unknown as {
      removeAssetPrefixQuietly(value: string): Promise<void>;
    };

    await internals.removeAssetPrefixQuietly(importId);

    expect(s3Client.send.mock.calls[0][0]).toBeInstanceOf(ListObjectsV2Command);
    expect(s3Client.send.mock.calls[1][0].input.ContinuationToken).toBe(
      'next-page',
    );
    const deletions = s3Client.send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof DeleteObjectsCommand);
    expect(deletions).toHaveLength(2);
    expect(deletions[0].input.Delete?.Objects).toHaveLength(1_000);
    expect(deletions[1].input.Delete?.Objects).toHaveLength(3);
  });
});
