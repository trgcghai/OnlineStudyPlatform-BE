import { AiHttpClientService } from '../ai-client/ai-http-client.service';
import { AiSummaryClient } from './ai-summary.client';

describe('AiSummaryClient', () => {
  let httpClient: { post: jest.Mock };
  let client: AiSummaryClient;

  beforeEach(() => {
    httpClient = { post: jest.fn() };
    client = new AiSummaryClient(
      httpClient as unknown as AiHttpClientService,
    );
  });

  it('transcribes audio through the shared AI HTTP client', async () => {
    httpClient.post.mockResolvedValue({
      transcript: 'hello',
      language: 'en',
      durationSeconds: 12,
    });

    await expect(
      client.transcribe({ lessonId: 'lesson-1', audioUrl: 'audio.ogg' }),
    ).resolves.toEqual({
      transcript: 'hello',
      language: 'en',
      durationSeconds: 12,
    });
    expect(httpClient.post).toHaveBeenCalledWith(
      '/transcribe',
      { lessonId: 'lesson-1', audioUrl: 'audio.ogg' },
      { timeoutMs: 1_800_000 },
    );
  });

  it('accepts a 9router summary response with the summary timeout', async () => {
    const response = {
      summary: '## Tổng quan\n\nBản tóm tắt.',
      provider: '9router',
    };
    httpClient.post.mockResolvedValue(response);

    await expect(
      client.summarize({
        lessonId: 'lesson-1',
        title: 'Bài học',
        transcript: 'Nội dung bài học.',
      }),
    ).resolves.toEqual(response);
    expect(httpClient.post).toHaveBeenCalledWith(
      '/summarize',
      {
        lessonId: 'lesson-1',
        title: 'Bài học',
        transcript: 'Nội dung bài học.',
      },
      { timeoutMs: 900_000 },
    );
  });

  it('rejects invalid summarize response shapes', async () => {
    httpClient.post.mockResolvedValue({ summary: '' });

    await expect(
      client.summarize({ lessonId: 'lesson-1', title: 'Lesson', transcript: 'text' }),
    ).rejects.toThrow('AI service returned an invalid summary response');
  });

  it('rejects an unknown summary provider', async () => {
    httpClient.post.mockResolvedValue({
      summary: 'Valid summary text',
      provider: 'unknown',
    });

    await expect(
      client.summarize({ lessonId: 'lesson-1', title: 'Lesson', transcript: 'text' }),
    ).rejects.toThrow('AI service returned an invalid summary response');
  });
});
