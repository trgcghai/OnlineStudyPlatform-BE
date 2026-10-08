import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

@Injectable()
export class LessonVideoMetadataService {
  constructor(private readonly configService: ConfigService) {}

  async getDuration(source: Readable, sourceName: string): Promise<number> {
    const directory = await mkdtemp(join(tmpdir(), 'lesson-video-metadata-'));
    const extension = extname(sourceName).toLowerCase();
    const inputPath = join(
      directory,
      `source${/^\.[a-z0-9]{1,8}$/.test(extension) ? extension : '.media'}`,
    );

    try {
      await pipeline(source, createWriteStream(inputPath, { flags: 'wx' }));
      const stdout = await this.probe(inputPath);
      const metadata = JSON.parse(stdout) as {
        streams?: { codec_type?: string }[];
        format?: { duration?: string };
      } | null;
      const seconds = Number(metadata?.format?.duration);
      if (
        !metadata?.streams?.some((stream) => stream.codec_type === 'video') ||
        !Number.isFinite(seconds) ||
        seconds <= 0 ||
        seconds > 2_147_483_647
      ) {
        throw new Error('Video must have a finite, positive duration');
      }
      return Math.max(1, Math.round(seconds));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async probe(inputPath: string): Promise<string> {
    const { stdout } = await execFileAsync(
      this.configService.get<string>('FFPROBE_PATH') || 'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_type:format=duration',
        '-of',
        'json',
        inputPath,
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true },
    );
    return stdout;
  }
}
