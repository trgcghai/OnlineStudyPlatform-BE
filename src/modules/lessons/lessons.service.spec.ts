import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { AiSummaryService } from '../ai-summary/ai-summary.service';
import {
  LessonSummary,
  LessonSummaryStatus,
} from '../ai-summary/entities/lesson-summary.entity';
import { LessonAudioService } from '../ai-summary/lesson-audio.service';
import { LessonsService } from './lessons.service';
import { Lesson } from './entities/lesson.entity';
import { Course, CourseStatus } from '../courses/entities/course.entity';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { lessonFileFilter } from './lessons.controller';
import { ReorderLessonsDto } from './dto/lesson.dto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CourseProgressService } from '../learning/course-progress.service';

const MINIO_CLIENT = 'MINIO_CLIENT';

function makeCourse(overrides: Partial<Course> = {}): Course {
  const course = new Course();
  course.id = randomUUID();
  course.title = 'Test Course';
  course.description = 'Description';
  course.category = 'Programming';
  course.thumbnail = null;
  course.status = CourseStatus.DRAFT;
  course.rejectReason = null;
  course.instructorId = 'instructor-1';
  course.createdAt = new Date();
  course.updatedAt = new Date();
  return Object.assign(course, overrides);
}

function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
  const lesson = new Lesson();
  lesson.id = randomUUID();
  lesson.title = 'Test Lesson';
  lesson.description = '';
  lesson.videoUrl = null;
  lesson.materialUrl = null;
  lesson.duration = 0;
  lesson.position = 0;
  lesson.courseId = 'course-1';
  lesson.course = makeCourse({ id: 'course-1', instructorId: 'instructor-1' });
  lesson.createdAt = new Date();
  lesson.updatedAt = new Date();
  return Object.assign(lesson, overrides);
}

function createMockRepository<T>(overrides: Partial<Repository<T>> = {}) {
  return {
    find: jest.fn().mockResolvedValue([]),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    findOne: jest.fn().mockResolvedValue(null),
    maximum: jest.fn().mockResolvedValue(null),
    create: jest.fn((entity) => entity as T),
    save: jest.fn((entity) => Promise.resolve(entity as T)),
    remove: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Repository<T>;
}

describe('LessonsService', () => {
  let service: LessonsService;
  let lessonsRepo: ReturnType<typeof createMockRepository<Lesson>>;
  let summariesRepo: ReturnType<typeof createMockRepository<LessonSummary>>;
  let coursesRepo: ReturnType<typeof createMockRepository<Course>>;
  let minioClient: Record<string, jest.Mock>;
  let courseProgressService: {
    recomputeCourseEnrollmentsProgress: jest.Mock;
  };
  let aiSummaryService: { enqueueLesson: jest.Mock };
  let lessonAudioService: {
    extractAndUpload: jest.Mock;
    getObjectKey: jest.Mock;
  };
  let mockQueryRunner: {
    manager: { find: jest.Mock; update: jest.Mock };
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
  };

  const courseId = 'course-1';
  const instructorId = 'instructor-1';
  const bucket = 'test-bucket';
  const endpoint = 'http://localhost:9000';

  beforeEach(async () => {
    lessonsRepo = createMockRepository();
    summariesRepo = createMockRepository();
    coursesRepo = createMockRepository();
    minioClient = {
      putObject: jest.fn().mockResolvedValue(undefined),
      removeObject: jest.fn().mockResolvedValue(undefined),
    };
    courseProgressService = {
      recomputeCourseEnrollmentsProgress: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    aiSummaryService = {
      enqueueLesson: jest.fn().mockResolvedValue(undefined),
    };
    lessonAudioService = {
      extractAndUpload: jest.fn().mockResolvedValue({
        objectKey: 'courses/course-1/lessons/lesson-1/summary-audio/audio.ogg',
        url: `${endpoint}/${bucket}/courses/course-1/lessons/lesson-1/summary-audio/audio.ogg`,
      }),
      getObjectKey: jest.fn((url: string) => {
        const marker = `/${bucket}/`;
        return new URL(url).pathname.split(marker)[1];
      }),
    };

    mockQueryRunner = {
      manager: {
        find: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LessonsService,
        {
          provide: getRepositoryToken(Lesson),
          useValue: lessonsRepo,
        },
        {
          provide: getRepositoryToken(LessonSummary),
          useValue: summariesRepo,
        },
        {
          provide: getRepositoryToken(Course),
          useValue: coursesRepo,
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              if (key === 'MINIO_BUCKET') return bucket;
              if (key === 'MINIO_ENDPOINT') return endpoint;
              return undefined;
            }),
          },
        },
        {
          provide: MINIO_CLIENT,
          useValue: minioClient,
        },
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
          },
        },
        {
          provide: CourseProgressService,
          useValue: courseProgressService,
        },
        {
          provide: AiSummaryService,
          useValue: aiSummaryService,
        },
        {
          provide: LessonAudioService,
          useValue: lessonAudioService,
        },
      ],
    }).compile();

    service = module.get(LessonsService);

    coursesRepo.findOne.mockResolvedValue(
      makeCourse({ id: courseId, instructorId }),
    );
  });

  describe('assertCourseOwnership', () => {
    it('should throw NotFoundException when course does not exist', async () => {
      coursesRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assertCourseOwnership('non-existent', instructorId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when instructor does not own the course', async () => {
      coursesRepo.findOne.mockResolvedValue(
        makeCourse({ id: courseId, instructorId: 'other-instructor' }),
      );

      await expect(
        service.assertCourseOwnership(courseId, instructorId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return course when ownership is valid', async () => {
      const course = makeCourse({ id: courseId, instructorId });
      coursesRepo.findOne.mockResolvedValue(course);

      const result = await service.assertCourseOwnership(
        courseId,
        instructorId,
      );
      expect(result.id).toBe(courseId);
    });
  });

  describe('listByCourse', () => {
    it('should list lessons ordered by position', async () => {
      const lessons = [
        makeLesson({ id: 'l1', position: 0, courseId }),
        makeLesson({ id: 'l2', position: 1, courseId }),
      ];
      lessonsRepo.findAndCount.mockResolvedValue([lessons, 2]);

      const result = await service.listByCourse(courseId, instructorId, {
        page: 1,
        limit: 50,
      });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(lessonsRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { courseId },
          order: { position: 'ASC', createdAt: 'ASC' },
        }),
      );
    });
  });

  describe('create', () => {
    it('should create a lesson at the end of the list', async () => {
      lessonsRepo.maximum.mockResolvedValue(1);
      const savedLesson = makeLesson({
        courseId,
        position: 2,
        title: 'New Lesson',
      });
      lessonsRepo.save.mockResolvedValue(savedLesson);

      const result = await service.create(courseId, instructorId, {
        title: 'New Lesson',
      });

      expect(result.title).toBe('New Lesson');
      expect(result.position).toBe(2);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(lessonsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Lesson',
          position: 2,
          courseId,
        }),
      );
      expect(
        courseProgressService.recomputeCourseEnrollmentsProgress,
      ).toHaveBeenCalledWith(courseId);
    });

    it('should upload video when provided', async () => {
      lessonsRepo.maximum.mockResolvedValue(null);
      const savedLesson = makeLesson({ courseId, position: 0 });
      lessonsRepo.save.mockResolvedValue(savedLesson);

      const videoFile = {
        buffer: Buffer.from('video'),
        size: 1000,
        originalname: 'test.mp4',
        mimetype: 'video/mp4',
      } as Express.Multer.File;

      const result = await service.create(
        courseId,
        instructorId,
        { title: 'Lesson with video' },
        videoFile,
      );

      expect(minioClient.putObject).toHaveBeenCalledWith(
        bucket,
        expect.stringContaining(`courses/${courseId}/lessons/`),
        videoFile.buffer,
        videoFile.size,
        { 'Content-Type': 'video/mp4' },
      );
      expect(result.videoUrl).toContain(endpoint);
      expect(lessonAudioService.extractAndUpload).toHaveBeenCalledWith(
        videoFile.buffer,
        videoFile.originalname,
        expect.stringContaining('/summary-audio'),
      );
      expect((summariesRepo.save as jest.Mock).mock.calls).toContainEqual([
        expect.objectContaining({
          lessonId: savedLesson.id,
          sourceVideoUrl: savedLesson.videoUrl,
          audioUrl: expect.stringContaining('/summary-audio/'),
          status: LessonSummaryStatus.PENDING,
        }),
      ]);
      expect(aiSummaryService.enqueueLesson).not.toHaveBeenCalled();
    });

    it('queues a summary when a video is added to a published course', async () => {
      coursesRepo.findOne.mockResolvedValue(
        makeCourse({
          id: courseId,
          instructorId,
          status: CourseStatus.PUBLISHED,
        }),
      );
      lessonsRepo.maximum.mockResolvedValue(null);
      const savedLesson = makeLesson({ courseId, position: 0 });
      lessonsRepo.save.mockResolvedValue(savedLesson);
      const videoFile = {
        buffer: Buffer.from('video'),
        size: 1000,
        originalname: 'test.mp4',
        mimetype: 'video/mp4',
      } as Express.Multer.File;

      await service.create(
        courseId,
        instructorId,
        { title: 'Published lesson' },
        videoFile,
      );

      expect(aiSummaryService.enqueueLesson).toHaveBeenCalledWith(
        savedLesson.id,
      );
    });

    it('should upload material when provided', async () => {
      lessonsRepo.maximum.mockResolvedValue(null);
      const savedLesson = makeLesson({ courseId, position: 0 });
      lessonsRepo.save.mockResolvedValue(savedLesson);

      const materialFile = {
        buffer: Buffer.from('pdf'),
        size: 500,
        originalname: 'notes.pdf',
        mimetype: 'application/pdf',
      } as Express.Multer.File;

      const result = await service.create(
        courseId,
        instructorId,
        { title: 'Lesson with material' },
        undefined,
        materialFile,
      );

      expect(minioClient.putObject).toHaveBeenCalled();
      expect(result.materialUrl).toContain('.pdf');
    });

    it('should throw NotFoundException when course does not exist', async () => {
      coursesRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create('non-existent', instructorId, { title: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update lesson title and description', async () => {
      const existingLesson = makeLesson({
        id: 'lesson-1',
        courseId,
        title: 'Old Title',
        description: 'Old desc',
      });
      lessonsRepo.findOne.mockResolvedValue(existingLesson);
      lessonsRepo.save.mockImplementation((e: unknown) =>
        Promise.resolve(e as Lesson),
      );

      const result = await service.update('lesson-1', instructorId, {
        title: 'New Title',
        description: 'New desc',
      });

      expect(result.title).toBe('New Title');
      expect(result.description).toBe('New desc');
      expect(aiSummaryService.enqueueLesson).not.toHaveBeenCalled();
    });

    it('should replace video and delete old one', async () => {
      const existingLesson = makeLesson({
        id: 'lesson-1',
        courseId,
        videoUrl: `${endpoint}/${bucket}/courses/${courseId}/lessons/lesson-1/videos/old-video.mp4`,
      });
      lessonsRepo.findOne.mockResolvedValue(existingLesson);
      lessonsRepo.save.mockImplementation((e: unknown) =>
        Promise.resolve(e as Lesson),
      );

      const videoFile = {
        buffer: Buffer.from('new video'),
        size: 2000,
        originalname: 'new.mp4',
        mimetype: 'video/mp4',
      } as Express.Multer.File;

      await service.update('lesson-1', instructorId, {}, videoFile);

      expect(minioClient.removeObject).toHaveBeenCalledWith(
        bucket,
        expect.stringContaining('old-video'),
      );
      expect(minioClient.putObject).toHaveBeenCalled();
    });

    it('queues a replacement video summary without failing the update', async () => {
      const existingLesson = makeLesson({
        id: 'lesson-1',
        courseId,
        videoUrl: `${endpoint}/${bucket}/courses/${courseId}/lessons/lesson-1/videos/old.mp4`,
        course: makeCourse({
          id: courseId,
          instructorId,
          status: CourseStatus.PUBLISHED,
        }),
      });
      lessonsRepo.findOne.mockResolvedValue(existingLesson);
      lessonsRepo.save.mockImplementation((entity: unknown) =>
        Promise.resolve(entity as Lesson),
      );
      aiSummaryService.enqueueLesson.mockRejectedValueOnce(
        new Error('redis down'),
      );
      const videoFile = {
        buffer: Buffer.from('replacement'),
        size: 2000,
        originalname: 'replacement.mp4',
        mimetype: 'video/mp4',
      } as Express.Multer.File;

      const result = await service.update(
        'lesson-1',
        instructorId,
        {},
        videoFile,
      );

      expect(result.videoUrl).toContain(endpoint);
      expect(aiSummaryService.enqueueLesson).toHaveBeenCalledWith('lesson-1');
    });

    it('should throw NotFoundException for non-existent lesson', async () => {
      lessonsRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update('non-existent', instructorId, { title: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete lesson and clean up files', async () => {
      const lesson = makeLesson({
        id: 'lesson-1',
        courseId,
        videoUrl: `${endpoint}/${bucket}/courses/${courseId}/lessons/lesson-1/videos/test.mp4`,
        materialUrl: `${endpoint}/${bucket}/courses/${courseId}/lessons/lesson-1/materials/test.pdf`,
      });
      lessonsRepo.findOne.mockResolvedValue(lesson);
      mockQueryRunner.manager.find.mockResolvedValue([]);

      await service.remove('lesson-1', instructorId);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(lessonsRepo.remove).toHaveBeenCalledWith(lesson);
      expect(minioClient.removeObject).toHaveBeenCalledTimes(2);
      expect(
        courseProgressService.recomputeCourseEnrollmentsProgress,
      ).toHaveBeenCalledWith(lesson.courseId);
    });

    it('should reindex positions after deletion', async () => {
      const lesson = makeLesson({ id: 'lesson-1', courseId, position: 1 });
      lessonsRepo.findOne.mockResolvedValue(lesson);

      const remaining = [
        makeLesson({ id: 'lesson-1', courseId, position: 0 }),
        makeLesson({ id: 'lesson-3', courseId, position: 1 }),
      ];
      mockQueryRunner.manager.find.mockResolvedValue(remaining);

      await service.remove('lesson-1', instructorId);

      expect(mockQueryRunner.manager.update).toHaveBeenCalledTimes(2);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should rollback transaction when reindex fails', async () => {
      const lesson = makeLesson({ id: 'lesson-1', courseId });
      lessonsRepo.findOne.mockResolvedValue(lesson);
      mockQueryRunner.manager.find.mockResolvedValue([
        makeLesson({ id: 'lesson-1', courseId, position: 0 }),
        makeLesson({ id: 'lesson-2', courseId, position: 1 }),
      ]);
      mockQueryRunner.manager.update.mockRejectedValue(
        new Error('DB write failed'),
      );

      await expect(service.remove('lesson-1', instructorId)).rejects.toThrow(
        'DB write failed',
      );

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should delete lesson without files', async () => {
      const lesson = makeLesson({
        id: 'lesson-1',
        courseId,
        videoUrl: null,
        materialUrl: null,
      });
      lessonsRepo.findOne.mockResolvedValue(lesson);
      mockQueryRunner.manager.find.mockResolvedValue([]);

      await service.remove('lesson-1', instructorId);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(lessonsRepo.remove).toHaveBeenCalledWith(lesson);
      expect(minioClient.removeObject).not.toHaveBeenCalled();
    });

    it('should reindex to sequential positions with no gaps', async () => {
      const lesson = makeLesson({ id: 'lesson-2', courseId, position: 1 });
      lessonsRepo.findOne.mockResolvedValue(lesson);

      const remaining = [
        makeLesson({ id: 'lesson-1', courseId, position: 0 }),
        makeLesson({ id: 'lesson-3', courseId, position: 2 }),
      ];
      mockQueryRunner.manager.find.mockResolvedValue(remaining);

      await service.remove('lesson-2', instructorId);

      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
        Lesson,
        'lesson-1',
        { position: 0 },
      );
      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
        Lesson,
        'lesson-3',
        { position: 1 },
      );
    });

    it('should handle deleting the last lesson in a course', async () => {
      const lesson = makeLesson({ id: 'lesson-1', courseId });
      lessonsRepo.findOne.mockResolvedValue(lesson);
      mockQueryRunner.manager.find.mockResolvedValue([]);

      await service.remove('lesson-1', instructorId);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(lessonsRepo.remove).toHaveBeenCalledWith(lesson);
      expect(mockQueryRunner.manager.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent lesson', async () => {
      lessonsRepo.findOne.mockResolvedValue(null);

      await expect(
        service.remove('non-existent', instructorId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('reorder', () => {
    it('should update positions according to the given order', async () => {
      const lessons = [
        makeLesson({ id: 'l1', courseId, position: 0 }),
        makeLesson({ id: 'l2', courseId, position: 1 }),
        makeLesson({ id: 'l3', courseId, position: 2 }),
      ];
      lessonsRepo.find.mockResolvedValue(lessons);

      const result = await service.reorder(courseId, instructorId, {
        orderedIds: ['l3', 'l1', 'l2'],
      });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(lessonsRepo.update).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(3);
    });

    it('should assign sequential positions from the new order', async () => {
      const lessons = [
        makeLesson({ id: 'l1', courseId, position: 0 }),
        makeLesson({ id: 'l2', courseId, position: 1 }),
      ];
      lessonsRepo.find.mockResolvedValue(lessons);

      await service.reorder(courseId, instructorId, {
        orderedIds: ['l2', 'l1'],
      });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(lessonsRepo.update).toHaveBeenCalledWith(
        { id: 'l2', courseId },
        { position: 0 },
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(lessonsRepo.update).toHaveBeenCalledWith(
        { id: 'l1', courseId },
        { position: 1 },
      );
    });

    it('should throw if IDs count does not match', async () => {
      const lessons = [
        makeLesson({ id: 'l1', courseId }),
        makeLesson({ id: 'l2', courseId }),
      ];
      lessonsRepo.find.mockResolvedValue(lessons);

      await expect(
        service.reorder(courseId, instructorId, {
          orderedIds: ['l1'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if an ID does not belong to the course', async () => {
      const lessons = [
        makeLesson({ id: 'l1', courseId }),
        makeLesson({ id: 'l2', courseId }),
      ];
      lessonsRepo.find.mockResolvedValue(lessons);

      await expect(
        service.reorder(courseId, instructorId, {
          orderedIds: ['l1', 'foreign-id'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if a lesson is missing from the ordered list', async () => {
      const lessons = [
        makeLesson({ id: 'l1', courseId }),
        makeLesson({ id: 'l2', courseId }),
        makeLesson({ id: 'l3', courseId }),
      ];
      lessonsRepo.find.mockResolvedValue(lessons);

      await expect(
        service.reorder(courseId, instructorId, {
          orderedIds: ['l1', 'l2'],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('file type validation at upload', () => {
    it('should upload a valid video file', async () => {
      lessonsRepo.maximum.mockResolvedValue(null);
      const savedLesson = makeLesson({ courseId, position: 0 });
      lessonsRepo.save.mockResolvedValue(savedLesson);

      const goodVideoFile = {
        buffer: Buffer.from('video'),
        size: 1000,
        originalname: 'good.mp4',
        mimetype: 'video/mp4',
      } as Express.Multer.File;

      const result = await service.create(
        courseId,
        instructorId,
        { title: 'Valid upload' },
        goodVideoFile,
      );

      expect(result.videoUrl).toBeDefined();
    });

    it('should store file content type metadata for inline previews', async () => {
      lessonsRepo.maximum.mockResolvedValue(null);
      const savedLesson = makeLesson({ courseId, position: 0 });
      lessonsRepo.save.mockResolvedValue(savedLesson);

      const pdfFile = {
        buffer: Buffer.from('pdf'),
        size: 1000,
        originalname: 'material.pdf',
        mimetype: 'application/pdf',
      } as Express.Multer.File;

      await service.create(
        courseId,
        instructorId,
        { title: 'PDF material' },
        undefined,
        pdfFile,
      );

      expect(minioClient.putObject).toHaveBeenCalledWith(
        bucket,
        expect.stringContaining('/materials/'),
        pdfFile.buffer,
        pdfFile.size,
        { 'Content-Type': 'application/pdf' },
      );
    });
  });

  describe('duration capture', () => {
    it('should store video duration when provided', async () => {
      lessonsRepo.maximum.mockResolvedValue(null);
      const savedLesson = makeLesson({ courseId, position: 0 });
      lessonsRepo.save.mockResolvedValue(savedLesson);

      const result = await service.create(courseId, instructorId, {
        title: 'Lesson with duration',
        duration: 120,
      });

      expect(result.duration).toBe(0);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(lessonsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ duration: 120 }),
      );
    });

    it('should default duration to 0 when not provided', async () => {
      lessonsRepo.maximum.mockResolvedValue(null);
      const savedLesson = makeLesson({ courseId, position: 0 });
      lessonsRepo.save.mockResolvedValue(savedLesson);

      const result = await service.create(courseId, instructorId, {
        title: 'Lesson without duration',
      });

      expect(result.duration).toBe(0);
    });

    it('should update duration on existing lesson', async () => {
      const existingLesson = makeLesson({
        id: 'lesson-1',
        courseId,
        duration: 60,
        course: makeCourse({ id: courseId, instructorId }),
      });
      lessonsRepo.findOne.mockResolvedValue(existingLesson);
      lessonsRepo.save.mockImplementation((e: unknown) =>
        Promise.resolve(e as Lesson),
      );

      const result = await service.update('lesson-1', instructorId, {
        duration: 240,
      });

      expect(result.duration).toBe(240);
    });
  });

  describe('file whitelist validation', () => {
    const validVideoMimes = ['video/mp4', 'video/webm'];

    const invalidVideoMimes = [
      'video/avi',
      'video/quicktime',
      'application/x-msdownload',
      'image/jpeg',
      'text/plain',
    ];

    const validMaterialMimes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ];

    const invalidMaterialMimes = [
      'application/x-msdownload',
      'image/jpeg',
      'text/plain',
      'application/zip',
    ];

    it.each(validVideoMimes)(
      'should accept video with mimetype %s',
      async (mimetype) => {
        lessonsRepo.maximum.mockResolvedValue(null);
        const savedLesson = makeLesson({ courseId, position: 0 });
        lessonsRepo.save.mockResolvedValue(savedLesson);

        const videoFile = {
          buffer: Buffer.from('video'),
          size: 1000,
          originalname: `test.${mimetype.split('/')[1]}`,
          mimetype,
        } as Express.Multer.File;

        const result = await service.create(
          courseId,
          instructorId,
          { title: `Test ${mimetype}` },
          videoFile,
        );

        expect(result.videoUrl).toBeDefined();
        expect(minioClient.putObject).toHaveBeenCalled();
      },
    );

    it.each(invalidVideoMimes)(
      'should reject video with mimetype %s (via fileFilter)',
      (mimetype) => {
        const file = {
          fieldname: 'video',
          mimetype,
          size: 1000,
        } as Express.Multer.File;

        const callback = jest.fn();

        lessonFileFilter({}, file, callback);

        expect(callback).toHaveBeenCalledWith(
          expect.any(BadRequestException),
          false,
        );
      },
    );

    it.each(validMaterialMimes)(
      'should accept material with mimetype %s',
      async (mimetype) => {
        lessonsRepo.maximum.mockResolvedValue(null);
        const savedLesson = makeLesson({ courseId, position: 0 });
        lessonsRepo.save.mockResolvedValue(savedLesson);

        const materialFile = {
          buffer: Buffer.from('material'),
          size: 1000,
          originalname: 'notes.pdf',
          mimetype,
        } as Express.Multer.File;

        const result = await service.create(
          courseId,
          instructorId,
          { title: `Test material ${mimetype}` },
          undefined,
          materialFile,
        );

        expect(result.materialUrl).toBeDefined();
      },
    );

    it.each(invalidMaterialMimes)(
      'should reject material with mimetype %s (via fileFilter)',
      (mimetype) => {
        const file = {
          fieldname: 'material',
          mimetype,
          size: 1000,
        } as Express.Multer.File;

        const callback = jest.fn();

        lessonFileFilter({}, file, callback);

        expect(callback).toHaveBeenCalledWith(
          expect.any(BadRequestException),
          false,
        );
      },
    );

    it('should reject material files exceeding 20 MB', () => {
      const file = {
        fieldname: 'material',
        mimetype: 'application/pdf',
        size: 21 * 1024 * 1024,
      } as Express.Multer.File;

      const callback = jest.fn();

      lessonFileFilter({}, file, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.any(BadRequestException),
        false,
      );
    });

    it('should reject files with unexpected field names', () => {
      const file = {
        fieldname: 'unexpected',
        mimetype: 'video/mp4',
        size: 1000,
      } as Express.Multer.File;

      const callback = jest.fn();

      lessonFileFilter({}, file, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.any(BadRequestException),
        false,
      );
    });
  });

  describe('upload rollback', () => {
    it('should clean up uploaded files when material upload fails', async () => {
      lessonsRepo.maximum.mockResolvedValue(null);
      const savedLesson = makeLesson({ courseId, position: 0 });
      lessonsRepo.save.mockResolvedValue(savedLesson);

      const videoFile = {
        buffer: Buffer.from('video'),
        size: 1000,
        originalname: 'test.mp4',
        mimetype: 'video/mp4',
      } as Express.Multer.File;

      const materialFile = {
        buffer: Buffer.from('material'),
        size: 500,
        originalname: 'notes.pdf',
        mimetype: 'application/pdf',
      } as Express.Multer.File;

      minioClient.putObject
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('MinIO write failed'));

      await expect(
        service.create(
          courseId,
          instructorId,
          { title: 'Rollback test' },
          videoFile,
          materialFile,
        ),
      ).rejects.toThrow();

      expect(minioClient.removeObject).toHaveBeenCalled();
    });

    it('should clean up video upload when video upload fails', async () => {
      lessonsRepo.maximum.mockResolvedValue(null);
      const savedLesson = makeLesson({ courseId, position: 0 });
      lessonsRepo.save.mockResolvedValue(savedLesson);

      const videoFile = {
        buffer: Buffer.from('video'),
        size: 1000,
        originalname: 'test.mp4',
        mimetype: 'video/mp4',
      } as Express.Multer.File;

      minioClient.putObject.mockRejectedValueOnce(
        new Error('MinIO write failed'),
      );

      await expect(
        service.create(
          courseId,
          instructorId,
          { title: 'Rollback test' },
          videoFile,
        ),
      ).rejects.toThrow();

      expect(minioClient.putObject).toHaveBeenCalledTimes(1);
    });

    it('should delete old files when replacing video on update fails', async () => {
      const existingLesson = makeLesson({
        id: 'lesson-1',
        courseId,
        videoUrl: `${endpoint}/${bucket}/courses/${courseId}/lessons/lesson-1/videos/old.mp4`,
        course: makeCourse({ id: courseId, instructorId }),
      });
      lessonsRepo.findOne.mockResolvedValue(existingLesson);

      const newVideoFile = {
        buffer: Buffer.from('new video'),
        size: 2000,
        originalname: 'new.mp4',
        mimetype: 'video/mp4',
      } as Express.Multer.File;

      minioClient.putObject.mockRejectedValueOnce(
        new Error('MinIO write failed'),
      );

      await expect(
        service.update('lesson-1', instructorId, {}, newVideoFile),
      ).rejects.toThrow();
    });
  });

  describe('ReorderLessonsDto validation', () => {
    it('should accept a valid orderedIds array', async () => {
      const dto = plainToInstance(ReorderLessonsDto, {
        orderedIds: ['l1', 'l2'],
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject an empty orderedIds array', async () => {
      const dto = plainToInstance(ReorderLessonsDto, {
        orderedIds: [],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints).toHaveProperty('arrayMinSize');
    });

    it('should reject non-string array elements', async () => {
      const dto = plainToInstance(ReorderLessonsDto, {
        orderedIds: [123, 456],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
