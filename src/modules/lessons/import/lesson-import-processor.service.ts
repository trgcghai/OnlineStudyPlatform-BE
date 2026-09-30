import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Client as MinioClient } from 'minio';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { DataSource, Repository } from 'typeorm';
import { MINIO_CLIENT } from '../../../common/constants/file.constant';
import { AiSummaryService } from '../../ai-summary/ai-summary.service';
import { AiKnowledgeService } from '../../ai-knowledge/ai-knowledge.service';
import {
  LessonSummary,
  LessonSummaryStatus,
} from '../../ai-summary/entities/lesson-summary.entity';
import { LessonAudioService } from '../../ai-summary/lesson-audio.service';
import { Course, CourseStatus } from '../../courses/entities/course.entity';
import {
  LessonImportRow,
  LessonZipArchive,
  LessonZipAsset,
  ZipService,
  ZipValidationError,
} from '../../file/zip.service';
import { CourseProgressService } from '../../learning/course-progress.service';
import {
  LessonImport,
  LessonImportStatus,
} from '../entities/lesson-import.entity';
import { Lesson } from '../entities/lesson.entity';

export { ZipValidationError as LessonImportValidationError } from '../../file/zip.service';

interface PreparedLesson {
  id: string;
  row: LessonImportRow;
  videoUrl: string | null;
  summaryAudioUrl: string | null;
  materialUrl: string | null;
}

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

@Injectable()
export class LessonImportProcessorService {
  private readonly logger = new Logger(LessonImportProcessorService.name);

  constructor(
    @InjectRepository(LessonImport)
    private readonly importsRepository: Repository<LessonImport>,
    @Inject(MINIO_CLIENT) private readonly minioClient: MinioClient,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly progressService: CourseProgressService,
    private readonly zipService: ZipService,
    private readonly lessonAudioService: LessonAudioService,
    private readonly aiSummaryService: AiSummaryService,
    private readonly aiKnowledgeService: AiKnowledgeService,
  ) {}

  async process(importId: string): Promise<void> {
    const claimed = await this.importsRepository.update(
      { id: importId, status: LessonImportStatus.QUEUED },
      {
        status: LessonImportStatus.PROCESSING,
        progress: 40,
        startedAt: new Date(),
        errorDetails: [],
      },
    );
    if (!claimed.affected) return;

    const lessonImport = await this.importsRepository.findOneByOrFail({
      id: importId,
    });
    const temporaryDirectory =
      this.configService.get<string>('LESSON_IMPORT_TEMP_DIR') ??
      join(tmpdir(), 'lesson-imports');
    const temporaryPath = join(temporaryDirectory, `${importId}.zip`);

    try {
      await mkdir(temporaryDirectory, { recursive: true });
      await this.downloadSource(lessonImport, temporaryPath);
      await this.importArchive(lessonImport, temporaryPath);
      await this.removeSourceQuietly(lessonImport);
      void this.progressService
        .recomputeCourseEnrollmentsProgress(lessonImport.courseId)
        .catch((error: unknown) =>
          this.logger.warn(
            `Could not recompute course progress after import: ${String(error)}`,
          ),
        );
    } catch (error) {
      await this.removeAssetPrefixQuietly(importId);
      if (error instanceof ZipValidationError) {
        await this.importsRepository.update(importId, {
          status: LessonImportStatus.FAILED,
          progress: 100,
          errorDetails: error.details,
          completedAt: new Date(),
        });
        await this.removeSourceQuietly(lessonImport);
        return;
      }
      await this.importsRepository.update(importId, {
        status: LessonImportStatus.QUEUED,
        progress: 35,
      });
      throw error;
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }

  async failPermanently(importId: string): Promise<void> {
    const lessonImport = await this.importsRepository.findOne({
      where: { id: importId },
    });
    if (!lessonImport) return;
    await this.removeAssetPrefixQuietly(importId);
    await this.removeSourceQuietly(lessonImport);
    await this.importsRepository.update(importId, {
      status: LessonImportStatus.FAILED,
      progress: 100,
      errorDetails: ['Import failed after multiple processing attempts'],
      completedAt: new Date(),
    });
  }

  private async downloadSource(
    lessonImport: LessonImport,
    destination: string,
  ): Promise<void> {
    const stream = await this.minioClient.getObject(
      this.bucket,
      lessonImport.sourceObjectKey,
    );
    await pipeline(stream, createWriteStream(destination, { flags: 'w' }));
    await this.importsRepository.update(lessonImport.id, { progress: 45 });
  }

  private async importArchive(
    lessonImport: LessonImport,
    path: string,
  ): Promise<void> {
    const archive = await this.zipService.openLessonImport(path);
    try {
      await this.importsRepository.update(lessonImport.id, { progress: 50 });
      const prepared: PreparedLesson[] = archive.rows.map((row) => ({
        id: randomUUID(),
        row,
        videoUrl: null,
        summaryAudioUrl: null,
        materialUrl: null,
      }));
      await this.removeAssetPrefixQuietly(lessonImport.id);
      let uploaded = 0;
      for (const lesson of prepared) {
        if (lesson.row.videoFilename) {
          const videoAsset = archive.getAsset(
            'videos',
            lesson.row.videoFilename,
          );
          lesson.videoUrl = await this.uploadReferencedEntry(
            archive,
            videoAsset,
            lessonImport.id,
            lesson.id,
            'videos',
          );
          lesson.summaryAudioUrl = await this.createSummaryAudioQuietly(
            archive,
            videoAsset,
            lessonImport.id,
            lesson.id,
          );
          uploaded += 1;
        }
        if (lesson.row.materialFilename) {
          lesson.materialUrl = await this.uploadReferencedEntry(
            archive,
            archive.getAsset('materials', lesson.row.materialFilename),
            lessonImport.id,
            lesson.id,
            'materials',
          );
          uploaded += 1;
        }
        if (archive.referencedFileCount > 0) {
          await this.importsRepository.update(lessonImport.id, {
            progress:
              50 + Math.floor((uploaded / archive.referencedFileCount) * 40),
          });
        }
      }
      await this.persistLessons(lessonImport, prepared);
    } finally {
      archive.close();
    }
  }

  private async persistLessons(
    lessonImport: LessonImport,
    prepared: PreparedLesson[],
  ): Promise<void> {
    const queuedLessonIds = await this.dataSource.transaction(
      async (manager) => {
        const course = await manager.findOne(Course, {
          where: { id: lessonImport.courseId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!course || course.instructorId !== lessonImport.instructorId) {
          throw new ZipValidationError(['Course ownership changed']);
        }
        const finalLesson = await manager.findOne(Lesson, {
          where: { courseId: lessonImport.courseId },
          order: { position: 'DESC' },
        });
        const firstPosition = (finalLesson?.position ?? -1) + 1;
        const lessons = prepared.map((item, index) =>
          manager.create(Lesson, {
            id: item.id,
            courseId: lessonImport.courseId,
            title: item.row.title,
            description: item.row.description,
            duration: 0,
            position: firstPosition + index,
            videoUrl: item.videoUrl,
            materialUrl: item.materialUrl,
          }),
        );
        await manager.save(Lesson, lessons);
        const summaries = prepared
          .filter((item) => Boolean(item.videoUrl))
          .map((item) =>
            manager.create(LessonSummary, {
              lessonId: item.id,
              summaryText: null,
              status: LessonSummaryStatus.PENDING,
              error: null,
              sourceVideoUrl: item.videoUrl,
              audioUrl: item.summaryAudioUrl,
              updatedAt: new Date(),
            }),
          );
        if (summaries.length > 0) {
          await manager.save(LessonSummary, summaries);
        }
        await manager.update(LessonImport, lessonImport.id, {
          status: LessonImportStatus.COMPLETED,
          progress: 100,
          createdLessonCount: lessons.length,
          firstPosition,
          lastPosition: firstPosition + lessons.length - 1,
          completedAt: new Date(),
          errorDetails: [],
        });
        return course.status === CourseStatus.PUBLISHED
          ? {
              summary: lessons
                .filter((lesson) => Boolean(lesson.videoUrl))
                .map((lesson) => lesson.id),
              knowledge: lessons
                .filter((lesson) => Boolean(lesson.materialUrl))
                .map((lesson) => lesson.id),
            }
          : { summary: [], knowledge: [] };
      },
    );
    await Promise.all([
      this.enqueueSummariesQuietly(queuedLessonIds.summary),
      this.enqueueKnowledgeQuietly(queuedLessonIds.knowledge),
    ]);
  }

  private async enqueueSummariesQuietly(lessonIds: string[]): Promise<void> {
    const results = await Promise.allSettled(
      lessonIds.map((lessonId) =>
        this.aiSummaryService.enqueueLesson(lessonId),
      ),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error(
          `Could not enqueue AI summary for imported lesson ${lessonIds[index]}`,
          result.reason instanceof Error
            ? result.reason.stack
            : String(result.reason),
        );
      }
    });
  }

  private async enqueueKnowledgeQuietly(lessonIds: string[]): Promise<void> {
    const results = await Promise.allSettled(
      lessonIds.map((lessonId) =>
        this.aiKnowledgeService.enqueueMaterial(lessonId),
      ),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error(
          `Could not enqueue material knowledge for imported lesson ${lessonIds[index]}`,
          result.reason instanceof Error
            ? result.reason.stack
            : String(result.reason),
        );
      }
    });
  }

  private async uploadReferencedEntry(
    archive: LessonZipArchive,
    asset: LessonZipAsset,
    importId: string,
    lessonId: string,
    folder: 'videos' | 'materials',
  ): Promise<string> {
    const extension = extname(asset.path).toLowerCase();
    const key = `lesson-imports/${importId}/assets/${lessonId}/${folder}/${randomUUID()}${extension}`;
    const stream = await archive.openStream(asset);
    await this.minioClient.putObject(
      this.bucket,
      key,
      stream,
      asset.uncompressedSize,
      { 'Content-Type': MIME_TYPES[extension] },
    );
    return `${this.publicEndpoint.replace(/\/+$/, '')}/${this.bucket}/${key}`;
  }

  private async createSummaryAudioQuietly(
    archive: LessonZipArchive,
    asset: LessonZipAsset,
    importId: string,
    lessonId: string,
  ): Promise<string | null> {
    try {
      const source = await archive.openStream(asset);
      const audio = await this.lessonAudioService.extractAndUpload(
        source,
        asset.path,
        `lesson-imports/${importId}/assets/${lessonId}/summary-audio`,
      );
      return audio.url;
    } catch (error) {
      this.logger.warn(
        `Could not prepare summary audio for imported lesson ${lessonId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async removeSourceQuietly(lessonImport: LessonImport): Promise<void> {
    await this.minioClient
      .removeObject(this.bucket, lessonImport.sourceObjectKey)
      .catch(() => undefined);
  }

  private async removeAssetPrefixQuietly(importId: string): Promise<void> {
    const stream = this.minioClient.listObjectsV2(
      this.bucket,
      `lesson-imports/${importId}/assets/`,
      true,
    );
    const keys: string[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (item) => {
        if (item.name) keys.push(item.name);
      });
      stream.on('error', reject);
      stream.on('end', resolve);
    }).catch(() => undefined);
    if (keys.length)
      await this.minioClient
        .removeObjects(this.bucket, keys)
        .catch(() => undefined);
  }

  private get bucket(): string {
    return this.configService.getOrThrow<string>('MINIO_BUCKET');
  }

  private get publicEndpoint(): string {
    return (
      this.configService.get<string>('MINIO_PUBLIC_ENDPOINT') ??
      this.configService.getOrThrow<string>('MINIO_ENDPOINT')
    );
  }
}
