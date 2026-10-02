import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiChatRequest, AiChatResponse } from './dto/ai-chat.dto';

export const AI_UNAVAILABLE_MESSAGE =
  'AI chatbot tam thoi khong kha dung. Vui long thu lai sau.';

@Injectable()
export class AiChatGatewayService {
  private readonly logger = new Logger(AiChatGatewayService.name);

  constructor(private readonly configService: ConfigService) {}

  async chat(request: AiChatRequest): Promise<AiChatResponse | null> {
    const aiUrl = this.configService.get<string>('AI_URL')?.replace(/\/$/, '');

    if (!aiUrl) {
      return null;
    }

    const token = this.configService.get<string>('AI_TOKEN');
    const timeoutMs = this.configService.get<number>('AI_TIMEOUT_MS') ?? 4500;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${aiUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(`AI chat returned HTTP ${response.status}`);
        return null;
      }

      return (await response.json()) as AiChatResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI chat unavailable: ${message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
