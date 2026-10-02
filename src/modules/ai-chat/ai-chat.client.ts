import { Injectable, Logger } from '@nestjs/common';
import { AiHttpClientService } from '../ai-client/ai-http-client.service';
import { AiChatRequest, AiChatResponse } from './dto/ai-chat.dto';

export const AI_UNAVAILABLE_MESSAGE =
  'AI chatbot tam thoi khong kha dung. Vui long thu lai sau.';

@Injectable()
export class AiChatClient {
  private readonly logger = new Logger(AiChatClient.name);

  constructor(private readonly aiHttpClient: AiHttpClientService) {}

  async chat(request: AiChatRequest): Promise<AiChatResponse | null> {
    try {
      const payload = await this.aiHttpClient.post<unknown>('/chat', request);
      return this.isChatResponse(payload) ? payload : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI chat unavailable: ${message}`);
      return null;
    }
  }

  private isChatResponse(value: unknown): value is AiChatResponse {
    if (!value || typeof value !== 'object') return false;
    const response = value as Partial<AiChatResponse>;
    return (
      typeof response.answer === 'string' &&
      typeof response.inScope === 'boolean' &&
      typeof response.similarity === 'number' &&
      Number.isFinite(response.similarity) &&
      Array.isArray(response.citations)
    );
  }
}
