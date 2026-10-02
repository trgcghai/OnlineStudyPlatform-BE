import { AiHttpClientService } from '../ai-client/ai-http-client.service';
import { AiChatClient } from './ai-chat.client';

describe('AiChatClient', () => {
  const request = {
    learnerId: 'learner-1',
    courseId: 'course-1',
    question: 'Provider la gi?',
    similarityThreshold: 0.2,
    history: [],
    sources: [],
  };

  it('delegates chat requests to the shared AI HTTP client', async () => {
    const post = jest.fn().mockResolvedValue({
      answer: 'Tra loi',
      inScope: true,
      similarity: 0.5,
      citations: [],
    });
    const client = new AiChatClient({
      post,
    } as unknown as AiHttpClientService);

    await expect(client.chat(request)).resolves.toEqual(
      expect.objectContaining({ answer: 'Tra loi' }),
    );
    expect(post).toHaveBeenCalledWith('/chat', request);
  });

  it('returns null when the AI HTTP client is unavailable', async () => {
    const client = new AiChatClient({
      post: jest.fn().mockRejectedValue(new Error('AI service is not configured')),
    } as unknown as AiHttpClientService);

    await expect(client.chat(request)).resolves.toBeNull();
  });

  it('returns null when the AI response shape is invalid', async () => {
    const client = new AiChatClient({
      post: jest.fn().mockResolvedValue({ answer: 42 }),
    } as unknown as AiHttpClientService);

    await expect(client.chat(request)).resolves.toBeNull();
  });
});
