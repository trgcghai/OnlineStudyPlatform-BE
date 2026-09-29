import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RecommendationAiRequest,
  RecommendationAiResponse,
} from './dto/recommendation.dto';

@Injectable()
export class RecommendationsAiGateway {
  private readonly logger = new Logger(RecommendationsAiGateway.name);

  constructor(private readonly configService: ConfigService) {}

  async recommend(
    request: RecommendationAiRequest,
  ): Promise<RecommendationAiResponse | null> {
    const aiUrl = this.configService.get<string>('AI_URL')?.replace(/\/$/, '');

    if (!aiUrl) {
      return null;
    }

    const token = this.configService.get<string>('AI_TOKEN');
    const timeoutMs = this.configService.get<number>('AI_TIMEOUT_MS') ?? 4500;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${aiUrl}/recommend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(`AI recommendations returned HTTP ${response.status}`);
        return null;
      }

      const body = (await response.json()) as unknown;
      if (!this.isRecommendationAiResponse(body)) {
        this.logger.warn('AI recommendations returned invalid response shape');
        return null;
      }

      return body;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI recommendations unavailable: ${message}`);
      return null;
    } finally {
      clearTimeout(timeout);
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
