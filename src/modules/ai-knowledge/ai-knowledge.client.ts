import { Injectable, Logger } from '@nestjs/common';
import { AiHttpClientService } from '../ai-client/ai-http-client.service';
import { DEFAULT_AI_KNOWLEDGE_TIMEOUT_MS } from './ai-knowledge.constants';
import {
  AiKnowledgeIndexRequest,
  AiKnowledgeIndexResponse,
} from './dto/ai-knowledge.dto';

@Injectable()
export class AiKnowledgeClient {
  private readonly logger = new Logger(AiKnowledgeClient.name);

  constructor(private readonly aiHttpClient: AiHttpClientService) {}

  index(request: AiKnowledgeIndexRequest): Promise<AiKnowledgeIndexResponse> {
    return this.send<AiKnowledgeIndexResponse>(
      '/knowledge/index',
      () =>
        this.aiHttpClient.post('/knowledge/index', request, {
          timeoutMs: DEFAULT_AI_KNOWLEDGE_TIMEOUT_MS,
        }),
      this.isIndexResponse,
    );
  }

  async deleteSource(sourceId: string): Promise<void> {
    await this.send(
      `/knowledge/sources/${encodeURIComponent(sourceId)}`,
      () =>
        this.aiHttpClient.delete(
          `/knowledge/sources/${encodeURIComponent(sourceId)}`,
          { timeoutMs: DEFAULT_AI_KNOWLEDGE_TIMEOUT_MS },
        ),
      this.isDeleteResponse,
    );
  }

  async deleteCourse(courseId: string): Promise<void> {
    await this.send(
      `/knowledge/courses/${encodeURIComponent(courseId)}`,
      () =>
        this.aiHttpClient.delete(
          `/knowledge/courses/${encodeURIComponent(courseId)}`,
          { timeoutMs: DEFAULT_AI_KNOWLEDGE_TIMEOUT_MS },
        ),
      this.isDeleteResponse,
    );
  }

  private async send<T>(
    path: string,
    execute: () => Promise<unknown>,
    isValid: (value: unknown) => value is T,
  ): Promise<T> {
    try {
      const payload = await execute();
      if (!isValid(payload)) {
        throw new Error('AI service returned an invalid knowledge response');
      }
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI knowledge endpoint ${path} unavailable: ${message}`);
      throw new Error('AI knowledge service is unavailable', { cause: error });
    }
  }

  private isIndexResponse(
    this: void,
    value: unknown,
  ): value is AiKnowledgeIndexResponse {
    if (!value || typeof value !== 'object') return false;
    const response = value as Partial<AiKnowledgeIndexResponse>;
    return (
      typeof response.sourceId === 'string' &&
      typeof response.contentHash === 'string' &&
      Number.isInteger(response.chunkCount) &&
      Number(response.chunkCount) > 0
    );
  }

  private isDeleteResponse(
    this: void,
    value: unknown,
  ): value is { deleted: boolean } {
    return (
      Boolean(value) &&
      typeof value === 'object' &&
      (value as { deleted?: unknown }).deleted === true
    );
  }
}
