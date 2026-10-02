import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_AI_KNOWLEDGE_TIMEOUT_MS } from './ai-knowledge.constants';
import {
  AiKnowledgeIndexRequest,
  AiKnowledgeIndexResponse,
} from './dto/ai-knowledge.dto';

@Injectable()
export class AiKnowledgeGatewayService {
  private readonly logger = new Logger(AiKnowledgeGatewayService.name);

  constructor(private readonly configService: ConfigService) {}

  index(request: AiKnowledgeIndexRequest): Promise<AiKnowledgeIndexResponse> {
    return this.send<AiKnowledgeIndexResponse>(
      '/knowledge/index',
      'POST',
      request,
      this.isIndexResponse,
    );
  }

  async deleteSource(sourceId: string): Promise<void> {
    await this.send(
      `/knowledge/sources/${encodeURIComponent(sourceId)}`,
      'DELETE',
      undefined,
      this.isDeleteResponse,
    );
  }

  async deleteCourse(courseId: string): Promise<void> {
    await this.send(
      `/knowledge/courses/${encodeURIComponent(courseId)}`,
      'DELETE',
      undefined,
      this.isDeleteResponse,
    );
  }

  private async send<T>(
    path: string,
    method: 'POST' | 'DELETE',
    body: object | undefined,
    isValid: (value: unknown) => value is T,
  ): Promise<T> {
    const aiUrl = this.configService.get<string>('AI_URL')?.replace(/\/$/, '');
    if (!aiUrl) throw new Error('AI service is not configured');

    const timeoutMs = this.getPositiveNumber(
      'AI_KNOWLEDGE_TIMEOUT_MS',
      DEFAULT_AI_KNOWLEDGE_TIMEOUT_MS,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const token = this.configService.get<string>('AI_TOKEN');
      const response = await fetch(`${aiUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn(
          `AI knowledge endpoint ${path} returned ${response.status}`,
        );
        throw new Error('AI service rejected the knowledge request');
      }
      const payload: unknown = await response.json();
      if (!isValid(payload)) {
        throw new Error('AI service returned an invalid knowledge response');
      }
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI knowledge endpoint ${path} unavailable: ${message}`);
      throw new Error('AI knowledge service is unavailable', { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }

  private getPositiveNumber(key: string, fallback: number): number {
    const value = Number(this.configService.get<string | number>(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
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
