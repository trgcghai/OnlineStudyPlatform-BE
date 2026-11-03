import { Injectable, Logger } from '@nestjs/common';
import { AiHttpClientService } from '../ai-client/ai-http-client.service';
import {
  DEFAULT_AI_SUMMARIZE_TIMEOUT_MS,
  DEFAULT_AI_TRANSCRIBE_TIMEOUT_MS,
} from './ai-summary.constants';
import {
  AiSummarizeRequest,
  AiSummarizeResponse,
  AiTranscribeRequest,
  AiTranscribeResponse,
} from './dto/ai-summary.dto';

@Injectable()
export class AiSummaryClient {
  private readonly logger = new Logger(AiSummaryClient.name);

  constructor(private readonly aiHttpClient: AiHttpClientService) {}

  transcribe(request: AiTranscribeRequest): Promise<AiTranscribeResponse> {
    return this.post(
      '/transcribe',
      request,
      DEFAULT_AI_TRANSCRIBE_TIMEOUT_MS,
      this.isTranscribeResponse,
      'AI service returned an invalid transcription response',
    );
  }

  summarize(request: AiSummarizeRequest): Promise<AiSummarizeResponse> {
    return this.post(
      '/summarize',
      request,
      DEFAULT_AI_SUMMARIZE_TIMEOUT_MS,
      this.isSummarizeResponse,
      'AI service returned an invalid summary response',
    );
  }

  private async post<T>(
    path: string,
    body: object,
    timeoutMs: number,
    isValid: (value: unknown) => value is T,
    invalidMessage: string,
  ): Promise<T> {
    try {
      const payload = await this.aiHttpClient.post<unknown>(path, body, {
        timeoutMs,
      });
      if (!isValid(payload)) throw new Error(invalidMessage);
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI summary endpoint ${path} unavailable: ${message}`);
      throw error;
    }
  }

  private isTranscribeResponse(
    value: unknown,
  ): value is AiTranscribeResponse {
    if (!value || typeof value !== 'object') return false;
    const response = value as Partial<AiTranscribeResponse>;
    return (
      typeof response.transcript === 'string' &&
      response.transcript.trim().length > 0 &&
      typeof response.language === 'string' &&
      typeof response.durationSeconds === 'number' &&
      Number.isFinite(response.durationSeconds)
    );
  }

  private isSummarizeResponse(value: unknown): value is AiSummarizeResponse {
    if (!value || typeof value !== 'object') return false;
    const response = value as Partial<AiSummarizeResponse>;
    return (
      typeof response.summary === 'string' &&
      response.summary.trim().length > 0 &&
      response.provider === '9router'
    );
  }
}
