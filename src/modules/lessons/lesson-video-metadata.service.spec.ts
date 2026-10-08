import { ConfigService } from '@nestjs/config';
import { access, readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { LessonVideoMetadataService } from './lesson-video-metadata.service';

describe('LessonVideoMetadataService', () => {
  let service: LessonVideoMetadataService;
  let probe: jest.SpyInstance<Promise<string>, [string]>;

  beforeEach(() => {
    service = new LessonVideoMetadataService({
      get: jest.fn(),
    } as unknown as ConfigService);
    probe = jest.spyOn(
      service as unknown as { probe(path: string): Promise<string> },
      'probe',
    );
  });

  it('reads the source video and rounds its actual duration to seconds', async () => {
    probe.mockImplementation(async (inputPath) => {
      expect(await readFile(inputPath, 'utf8')).toBe('source-video');
      return JSON.stringify({
        streams: [{ codec_type: 'video' }],
        format: { duration: '2164.250' },
      });
    });

    await expect(
      service.getDuration(Readable.from(['source-video']), 'lecture.mp4'),
    ).resolves.toBe(2164);
    await expect(access(probe.mock.calls[0][0])).rejects.toThrow();
  });

  it.each(['0', '-1', 'N/A', 'Infinity', '2147483648', undefined])(
    'rejects an unusable duration %s and removes its temporary file',
    async (duration) => {
      probe.mockResolvedValue(
        JSON.stringify({
          streams: [{ codec_type: 'video' }],
          format: { duration },
        }),
      );
      await expect(
        service.getDuration(Readable.from(['video']), 'lecture.mp4'),
      ).rejects.toThrow('Video must have a finite, positive duration');
      await expect(access(probe.mock.calls[0][0])).rejects.toThrow();
    },
  );

  it('rejects files without a video stream', async () => {
    probe.mockResolvedValue(
      JSON.stringify({ streams: [], format: { duration: '120' } }),
    );
    await expect(
      service.getDuration(Readable.from(['audio']), 'lecture.mp4'),
    ).rejects.toThrow('Video must have a finite, positive duration');
  });

  it('preserves subprocess errors for import retry and cleans temporary files', async () => {
    probe.mockRejectedValue(new Error('ffprobe timed out'));
    await expect(
      service.getDuration(Readable.from(['video']), 'lecture.mp4'),
    ).rejects.toThrow('ffprobe timed out');
    await expect(access(probe.mock.calls[0][0])).rejects.toThrow();
  });
});
