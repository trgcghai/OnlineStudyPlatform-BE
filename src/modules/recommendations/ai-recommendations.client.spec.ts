import { AiHttpClientService } from '../ai-client/ai-http-client.service';
import { RecommendationAiRequest } from './dto/recommendation.dto';
import { AiRecommendationsClient } from './ai-recommendations.client';

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

describe('AiRecommendationsClient', () => {
  it('delegates valid recommendation requests to the shared client', async () => {
    const post = jest.fn().mockResolvedValue({ courseIds: ['course-2'] });
    const client = new AiRecommendationsClient({
      post,
    } as unknown as AiHttpClientService);

    await expect(client.recommend(request)).resolves.toEqual({
      courseIds: ['course-2'],
    });
    expect(post).toHaveBeenCalledWith('/recommend', request);
  });

  it('returns null for invalid responses and transport failures', async () => {
    const post = jest
      .fn()
      .mockResolvedValueOnce({ ids: ['course-2'] })
      .mockRejectedValueOnce(new Error('offline'));
    const client = new AiRecommendationsClient({
      post,
    } as unknown as AiHttpClientService);

    await expect(client.recommend(request)).resolves.toBeNull();
    await expect(client.recommend(request)).resolves.toBeNull();
  });
});
