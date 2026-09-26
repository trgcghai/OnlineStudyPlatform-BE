import { ConfigService } from '@nestjs/config';
import { Course } from '../../courses/entities/course.entity';
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
  const minio = { removeObject: jest.fn(), listObjectsV2: jest.fn() };
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
  let service: LessonImportProcessorService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LessonImportProcessorService(
      importsRepository as never,
      minio as never,
      {
        get: jest.fn(),
        getOrThrow: jest.fn((key: string) =>
          key === 'MINIO_BUCKET' ? 'course-assets' : 'http://localhost:9000',
        ),
      } as unknown as ConfigService,
      dataSource as never,
      progressService as never,
      zipService as never,
    );
  });

  it('appends imported lessons after the existing final position atomically', async () => {
    manager.findOne.mockImplementation((entity: object) =>
      Promise.resolve(
        entity === Course
          ? { id: 'course-id', instructorId: 'instructor-id' }
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
          videoUrl: null,
          materialUrl: null,
        },
        {
          id: 'lesson-2',
          row: { title: 'Second', description: '' },
          videoUrl: null,
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
});
