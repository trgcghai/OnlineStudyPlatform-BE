import { AiHttpClientService } from '../ai-client/ai-http-client.service';
import { AiKnowledgeClient } from './ai-knowledge.client';

describe('AiKnowledgeClient', () => {
  let httpClient: { post: jest.Mock; delete: jest.Mock };
  let client: AiKnowledgeClient;

  beforeEach(() => {
    httpClient = {
      post: jest.fn().mockResolvedValue({
        sourceId: 'source-1',
        contentHash: 'a'.repeat(64),
        chunkCount: 2,
      }),
      delete: jest.fn().mockResolvedValue({ deleted: true }),
    };
    client = new AiKnowledgeClient(
      httpClient as unknown as AiHttpClientService,
    );
  });

  it('indexes knowledge through the shared AI HTTP client', async () => {
    const request = {
      sourceId: 'source-1',
      courseId: 'course-1',
      lessonId: 'lesson-1',
      lessonTitle: 'Lesson',
      sourceType: 'transcript' as const,
      contentHash: 'a'.repeat(64),
      transcript: 'hello',
    };

    await expect(client.index(request)).resolves.toEqual({
      sourceId: 'source-1',
      contentHash: 'a'.repeat(64),
      chunkCount: 2,
    });
    expect(httpClient.post).toHaveBeenCalledWith('/knowledge/index', request, {
      timeoutMs: expect.any(Number),
    });
  });

  it('deletes a source through the shared AI HTTP client', async () => {
    await client.deleteSource('source 1');

    expect(httpClient.delete).toHaveBeenCalledWith(
      '/knowledge/sources/source%201',
      { timeoutMs: expect.any(Number) },
    );
  });
});
