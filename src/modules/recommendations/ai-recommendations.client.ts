import { Injectable, Logger } from '@nestjs/common';
import { AiHttpClientService } from '../ai-client/ai-http-client.service';
import {
  RecommendationAiRequest,
  RecommendationAiResponse,
} from './dto/recommendation.dto';

@Injectable()
export class AiRecommendationsClient {
  private readonly logger = new Logger(AiRecommendationsClient.name);

  constructor(private readonly aiHttpClient: AiHttpClientService) {}

  async recommend(
    request: RecommendationAiRequest,
  ): Promise<RecommendationAiResponse | null> {
    try {
      const body = await this.aiHttpClient.post<unknown>('/recommend', request);
      if (!this.isRecommendationAiResponse(body)) {
        this.logger.warn('AI recommendations returned invalid response shape');
        return null;
      }

      return body;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI recommendations unavailable: ${message}`);
      return null;
    }
  }

  private isRecommendationAiResponse(
    value: unknown,
  ): value is RecommendationAiResponse {
    return (
      typeof value === 'object' &&
      value !== null &&
      Array.isArray((value as RecommendationAiResponse).courseIds) &&
      (value as RecommendationAiResponse).courseIds.every(
        (courseId) => typeof courseId === 'string',
      )
    );
  }
}
