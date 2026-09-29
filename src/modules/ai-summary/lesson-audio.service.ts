import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import type { Client as MinioClient } from 'minio';
import { MINIO_CLIENT } from '../../common/constants/file.constant';

const execFileAsync = promisify(execFile);
const DEFAULT_AUDIO_EXTRACTION_TIMEOUT_MS = 10 * 60 * 1_000;
const MAX_FFMPEG_OUTPUT_BYTES = 1024 * 1024;

export interface DerivedLessonAudio {
  objectKey: string;
  url: string;
}

@Injectable()
export class LessonAudioService {
  constructor(
    @Inject(MINIO_CLIENT) private readonly minioClient: MinioClient,
    private readonly configService: ConfigService,
  ) {}

  async extractAndUpload(
    source: Buffer | Readable,
    sourceName: string,
    destinationPrefix: string,
  ): Promise<DerivedLessonAudio> {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'lesson-summary-audio-'),
    );
    const extension = this.safeExtension(sourceName);
    const inputPath = join(temporaryDirectory, `source${extension}`);
    const outputPath = join(temporaryDirectory, 'audio.ogg');
    const objectKey = `${destinationPrefix.replace(/\/+$/, '')}/${randomUUID()}.ogg`;

    try {
      const readable = Buffer.isBuffer(source)
        ? Readable.from([source])
        : source;
      await pipeline(readable, createWriteStream(inputPath, { flags: 'wx' }));
      await this.runFfmpeg(inputPath, outputPath);

      const output = await stat(outputPath);
      if (output.size <= 0) {
        throw new Error('FFmpeg produced an empty lesson audio file');
      }

      await this.minioClient.putObject(
        this.bucket,
        objectKey,
        createReadStream(outputPath),
        output.size,
        { 'Content-Type': 'audio/ogg' },
      );

      return {
        objectKey,
        url: `${this.internalEndpoint}/${this.bucket}/${objectKey}`,
      };
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async extractStoredVideo(
    videoUrl: string,
    courseId: string,
    lessonId: string,
  ): Promise<DerivedLessonAudio> {
    const sourceKey = this.getObjectKey(videoUrl);
    const source = await this.minioClient.getObject(this.bucket, sourceKey);
    return this.extractAndUpload(
      source,
      sourceKey,
      `courses/${courseId}/lessons/${lessonId}/summary-audio`,
    );
  }

  async removeAudioQuietly(audioUrl: string | null | undefined): Promise<void> {
    if (!audioUrl) return;
    try {
      await this.minioClient.removeObject(
        this.bucket,
        this.getObjectKey(audioUrl),
      );
    } catch {
      // Derived audio cleanup must not break video writes or lesson deletion.
    }
  }

  getObjectKey(objectUrl: string): string {
    let parsed: URL;
    try {
      parsed = new URL(objectUrl);
    } catch (error) {
      throw new Error('Lesson media URL is invalid', { cause: error });
    }

    const segments = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
    const bucketIndex = segments.indexOf(this.bucket);
    const objectKey =
      bucketIndex >= 0 ? segments.slice(bucketIndex + 1).join('/') : '';
    if (!objectKey) {
      throw new Error(
        'Lesson media URL does not belong to the configured bucket',
      );
    }
    return objectKey;
  }

  private async runFfmpeg(
    inputPath: string,
    outputPath: string,
  ): Promise<void> {
    const executable =
      this.configService.get<string>('FFMPEG_PATH') || 'ffmpeg';
    await execFileAsync(
      executable,
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        inputPath,
        '-map',
        '0:a:0',
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'libopus',
        '-b:a',
        '32k',
        outputPath,
      ],
      {
        timeout: this.getPositiveInteger(
          'AUDIO_EXTRACTION_TIMEOUT_MS',
          DEFAULT_AUDIO_EXTRACTION_TIMEOUT_MS,
        ),
        maxBuffer: MAX_FFMPEG_OUTPUT_BYTES,
        windowsHide: true,
      },
    );
  }

  private safeExtension(sourceName: string): string {
    const extension = extname(sourceName).toLowerCase();
    return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : '.media';
  }

  private getPositiveInteger(key: string, fallback: number): number {
    const value = Number(this.configService.get<string | number>(key));
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  private get bucket(): string {
    return this.configService.getOrThrow<string>('MINIO_BUCKET');
  }

  private get internalEndpoint(): string {
    return this.configService
      .getOrThrow<string>('MINIO_ENDPOINT')
      .replace(/\/+$/, '');
  }
}
