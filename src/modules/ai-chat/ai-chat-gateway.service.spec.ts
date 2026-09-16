import { ConfigService } from '@nestjs/config';
import { AiChatGatewayService } from './ai-chat-gateway.service';

describe('AiChatGatewayService', () => {
  const request = {
    learnerId: 'learner-1',
    courseId: 'course-1',
    question: 'Provider la gi?',
    similarityThreshold: 0.2,
    history: [],
    sources: [
      {
        lessonId: 'lesson-1',
        lessonTitle: 'Provider',
        content: 'Provider trong NestJS',
      },
    ],
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns null when AI_URL is not configured', async () => {
    const service = new AiChatGatewayService({
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService);

    await expect(service.chat(request)).resolves.toBeNull();
  });

  it('forwards chat request with bearer token', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          answer: 'Tra loi',
          inScope: true,
          similarity: 0.5,
          citations: [],
        }),
    } as Response);
    const service = new AiChatGatewayService({
      get: jest.fn((key: string) => {
        if (key === 'AI_URL') return 'http://ai:8000/';
        if (key === 'AI_TOKEN') return 'secret';
        if (key === 'AI_TIMEOUT_MS') return 1000;
        return undefined;
      }),
    } as unknown as ConfigService);

    await expect(service.chat(request)).resolves.toEqual(
      expect.objectContaining({ answer: 'Tra loi' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ai:8000/chat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      }),
    );
  });

  it('returns null on non-2xx AI response', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 503 } as Response);
    const service = new AiChatGatewayService({
      get: jest.fn((key: string) =>
        key === 'AI_URL' ? 'http://ai:8000' : undefined,
      ),
    } as unknown as ConfigService);

    await expect(service.chat(request)).resolves.toBeNull();
  });
});
