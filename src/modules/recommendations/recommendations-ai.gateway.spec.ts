import { ConfigService } from '@nestjs/config';
import { RecommendationAiRequest } from './dto/recommendation.dto';
import { RecommendationsAiGateway } from './recommendations-ai.gateway';

const request: RecommendationAiRequest = {
  learnerId: 'learner-1',
  limit: 2,
  signals: {
    categories: { Backend: 3 },
    completedCourseIds: ['course-1'],
    engagementByCourseId: { 'course-1': 4 },
    quizPerformanceByCourseId: { 'course-1': 0.8 },
  },
  candidates: [
    {
      id: 'course-2',
      title: 'Node Basics',
      category: 'Backend',
      description: 'Learn Node',
      popularity: 5,
    },
  ],
};

describe('RecommendationsAiGateway', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns null when AI_URL is not configured', async () => {
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const gateway = new RecommendationsAiGateway(
      config as unknown as ConfigService,
    );

    await expect(gateway.recommend(request)).resolves.toBeNull();
    expect(config.get).toHaveBeenCalledWith('AI_URL');
  });

  it('posts to /recommend and returns ordered course ids', async () => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'AI_URL') return 'http://ai.local/';
        if (key === 'AI_TOKEN') return 'secret';
        if (key === 'AI_TIMEOUT_MS') return 2500;
        return undefined;
      }),
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ courseIds: ['course-2'] }),
    });
    const gateway = new RecommendationsAiGateway(
      config as unknown as ConfigService,
    );

    await expect(gateway.recommend(request)).resolves.toEqual({
      courseIds: ['course-2'],
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://ai.local/recommend',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret',
        }),
        body: JSON.stringify(request),
      }),
    );
  });

  it('returns null when AI responds with invalid body', async () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'AI_URL' ? 'http://ai.local' : undefined,
      ),
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ ids: ['course-2'] }),
    });
    const gateway = new RecommendationsAiGateway(
      config as unknown as ConfigService,
    );

    await expect(gateway.recommend(request)).resolves.toBeNull();
  });

  it('returns null when AI request fails', async () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'AI_URL' ? 'http://ai.local' : undefined,
      ),
    };
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    const gateway = new RecommendationsAiGateway(
      config as unknown as ConfigService,
    );

    await expect(gateway.recommend(request)).resolves.toBeNull();
  });
});
