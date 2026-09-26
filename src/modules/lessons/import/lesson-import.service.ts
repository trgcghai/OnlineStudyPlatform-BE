import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Client as MinioClient } from 'minio';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import {
  LESSON_IMPORT_PART_SIZE_BYTES,
  LESSON_IMPORT_PRESIGNED_TTL_SECONDS,
  LESSON_IMPORT_SESSION_TTL_MS,
  MINIO_CLIENT,
  MINIO_PUBLIC_S3_CLIENT,
  MINIO_S3_CLIENT,
} from '../../../common/constants/file.constant';
import { Course } from '../../courses/entities/course.entity';
import {
  InitiateLessonImportDto,
  LessonImportInitiateResponse,
  LessonImportStatusResponse,
} from '../dto/lesson-import.dto';
import {
  LessonImport,
  LessonImportStatus,
} from '../entities/lesson-import.entity';
import { LessonImportQueuePublisher } from './queue/lesson-import-queue.publisher';

@Injectable()
export class LessonImportService {
  constructor(
    @InjectRepository(LessonImport)
    private readonly importsRepository: Repository<LessonImport>,
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    @Inject(MINIO_S3_CLIENT) private readonly s3Client: S3Client,
    @Inject(MINIO_PUBLIC_S3_CLIENT)
    private readonly publicS3Client: S3Client,
    @Inject(MINIO_CLIENT) private readonly minioClient: MinioClient,
    private readonly configService: ConfigService,
    private readonly queuePublisher: LessonImportQueuePublisher,
  ) {}

  async initiate(
    courseId: string,
    instructorId: string,
    dto: InitiateLessonImportDto,
  ): Promise<LessonImportInitiateResponse> {
    await this.assertCourseOwnership(courseId, instructorId);
    const existing = await this.importsRepository.findOne({
      where: [
        { courseId, status: LessonImportStatus.UPLOADING },
        { courseId, status: LessonImportStatus.QUEUED },
        { courseId, status: LessonImportStatus.PROCESSING },
      ],
    });
    if (existing) {
      throw new ConflictException('This course already has an active import');
    }

    const bucket = this.configService.getOrThrow<string>('MINIO_BUCKET');
    const importId = randomUUID();
    const key = `lesson-imports/${importId}/source/${this.safeFilename(dto.fileName)}`;
    const multipart = await this.s3Client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: 'application/zip',
      }),
    );
    if (!multipart.UploadId) {
      throw new Error('MinIO did not return a multipart upload ID');
    }

    const partCount = Math.ceil(dto.fileSize / LESSON_IMPORT_PART_SIZE_BYTES);
    const expiresAt = new Date(Date.now() + LESSON_IMPORT_SESSION_TTL_MS);
    try {
      await this.importsRepository.save(
        this.importsRepository.create({
          id: importId,
          courseId,
          instructorId,
          sourceFilename: dto.fileName,
          sourceObjectKey: key,
          declaredSize: dto.fileSize,
          multipartUploadId: multipart.UploadId,
          expectedPartCount: partCount,
          status: LessonImportStatus.UPLOADING,
          progress: 0,
          errorDetails: [],
          createdLessonCount: 0,
          firstPosition: null,
          lastPosition: null,
          expiresAt,
          startedAt: null,
          completedAt: null,
        }),
      );
    } catch (error) {
      await this.abortMultipartQuietly(bucket, key, multipart.UploadId);
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('This course already has an active import');
      }
      throw error;
    }

    const parts = await Promise.all(
      Array.from({ length: partCount }, async (_, index) => {
        const partNumber = index + 1;
        return {
          partNumber,
          url: await getSignedUrl(
            this.publicS3Client,
            new UploadPartCommand({
              Bucket: bucket,
              Key: key,
              UploadId: multipart.UploadId,
              PartNumber: partNumber,
            }),
            { expiresIn: LESSON_IMPORT_PRESIGNED_TTL_SECONDS },
          ),
        };
      }),
    );

    return {
      importId,
      partSize: LESSON_IMPORT_PART_SIZE_BYTES,
      parts,
      expiresAt,
    };
  }

  async complete(
    courseId: string,
    importId: string,
    instructorId: string,
  ): Promise<LessonImportStatusResponse> {
    const lessonImport = await this.findOwned(courseId, importId, instructorId);
    if (lessonImport.status !== LessonImportStatus.UPLOADING) {
      throw new ConflictException('Only an uploading import can be completed');
    }
    if (lessonImport.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException('Import upload session has expired');
    }

    const bucket = this.configService.getOrThrow<string>('MINIO_BUCKET');
    const listed = await this.s3Client.send(
      new ListPartsCommand({
        Bucket: bucket,
        Key: lessonImport.sourceObjectKey,
        UploadId: lessonImport.multipartUploadId,
      }),
    );
    const parts = [...(listed.Parts ?? [])].sort(
      (left, right) => (left.PartNumber ?? 0) - (right.PartNumber ?? 0),
    );
    this.assertUploadedParts(lessonImport, parts, Boolean(listed.IsTruncated));

    await this.s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: lessonImport.sourceObjectKey,
        UploadId: lessonImport.multipartUploadId,
        MultipartUpload: {
          Parts: parts.map((part) => ({
            ETag: part.ETag,
            PartNumber: part.PartNumber,
          })),
        },
      }),
    );
    const stat = await this.minioClient.statObject(
      bucket,
      lessonImport.sourceObjectKey,
    );
    if (stat.size !== lessonImport.declaredSize) {
      await this.minioClient.removeObject(bucket, lessonImport.sourceObjectKey);
      lessonImport.status = LessonImportStatus.FAILED;
      lessonImport.errorDetails = ['Uploaded ZIP size does not match fileSize'];
      await this.importsRepository.save(lessonImport);
      throw new ConflictException('Uploaded ZIP size does not match fileSize');
    }

    lessonImport.status = LessonImportStatus.QUEUED;
    lessonImport.progress = 35;
    await this.importsRepository.save(lessonImport);
    try {
      await this.queuePublisher.enqueue({ importId });
    } catch (error) {
      lessonImport.status = LessonImportStatus.FAILED;
      lessonImport.errorDetails = ['Could not queue the lesson import'];
      await this.importsRepository.save(lessonImport);
      await this.minioClient
        .removeObject(bucket, lessonImport.sourceObjectKey)
        .catch(() => undefined);
      throw error;
    }
    return this.toStatusResponse(lessonImport);
  }

  async getStatus(
    courseId: string,
    importId: string,
    instructorId: string,
  ): Promise<LessonImportStatusResponse> {
    return this.toStatusResponse(
      await this.findOwned(courseId, importId, instructorId),
    );
  }

  async abort(
    courseId: string,
    importId: string,
    instructorId: string,
  ): Promise<void> {
    const lessonImport = await this.findOwned(courseId, importId, instructorId);
    if (lessonImport.status !== LessonImportStatus.UPLOADING) {
      throw new ConflictException('Only an uploading import can be aborted');
    }
    const bucket = this.configService.getOrThrow<string>('MINIO_BUCKET');
    await this.abortMultipartQuietly(
      bucket,
      lessonImport.sourceObjectKey,
      lessonImport.multipartUploadId,
    );
    lessonImport.status = LessonImportStatus.ABORTED;
    lessonImport.progress = 0;
    await this.importsRepository.save(lessonImport);
  }

  private assertUploadedParts(
    lessonImport: LessonImport,
    parts: { PartNumber?: number; Size?: number; ETag?: string }[],
    truncated: boolean,
  ): void {
    if (truncated || parts.length !== lessonImport.expectedPartCount) {
      throw new ConflictException('Not all ZIP parts have been uploaded');
    }
    parts.forEach((part, index) => {
      const partNumber = index + 1;
      const expectedSize =
        partNumber === lessonImport.expectedPartCount
          ? lessonImport.declaredSize -
            LESSON_IMPORT_PART_SIZE_BYTES * (partNumber - 1)
          : LESSON_IMPORT_PART_SIZE_BYTES;
      if (
        part.PartNumber !== partNumber ||
        part.Size !== expectedSize ||
        !part.ETag
      ) {
        throw new ConflictException(`ZIP part ${partNumber} is invalid`);
      }
    });
  }

  private async findOwned(
    courseId: string,
    importId: string,
    instructorId: string,
  ): Promise<LessonImport> {
    const lessonImport = await this.importsRepository.findOne({
      where: { id: importId, courseId },
    });
    if (!lessonImport) throw new NotFoundException('Lesson import not found');
    if (lessonImport.instructorId !== instructorId) {
      throw new ForbiddenException('You do not own this lesson import');
    }
    return lessonImport;
  }

  private async assertCourseOwnership(
    courseId: string,
    instructorId: string,
  ): Promise<void> {
    const course = await this.coursesRepository.findOne({
      where: { id: courseId },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.instructorId !== instructorId) {
      throw new ForbiddenException('You do not own this course');
    }
  }

  private toStatusResponse(value: LessonImport): LessonImportStatusResponse {
    return {
      importId: value.id,
      status: value.status,
      progress: value.progress,
      errorDetails: value.errorDetails,
      createdLessonCount: value.createdLessonCount,
      failedRowCount: 0,
      firstPosition: value.firstPosition,
      lastPosition: value.lastPosition,
      expiresAt: value.expiresAt,
      createdAt: value.createdAt,
      completedAt: value.completedAt,
    };
  }

  private safeFilename(filename: string): string {
    return filename.replace(/[^a-z0-9._-]/gi, '_');
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    );
  }

  private async abortMultipartQuietly(
    bucket: string,
    key: string,
    uploadId: string,
  ): Promise<void> {
    try {
      await this.s3Client.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
        }),
      );
    } catch {
      // A best-effort cleanup must not hide the original error.
    }
  }
}
