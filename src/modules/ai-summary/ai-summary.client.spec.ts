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
      { timeoutMs: expect.any(Number) },
    );
  });

  it('rejects invalid summarize response shapes', async () => {
    httpClient.post.mockResolvedValue({ summary: '' });

    await expect(
      client.summarize({ lessonId: 'lesson-1', title: 'Lesson', transcript: 'text' }),
    ).rejects.toThrow('AI service returned an invalid summary response');
  });
});
