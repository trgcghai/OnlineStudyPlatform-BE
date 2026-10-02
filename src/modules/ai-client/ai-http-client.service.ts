import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AiRequestOptions {
  headers?: Record<string, string>;
  parseJson?: boolean;
  timeoutMs?: number;
}

export class AiHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseText?: string,
  ) {
    super(message);
    this.name = AiHttpError.name;
  }
}

@Injectable()
export class AiHttpClientService {
  constructor(private readonly configService: ConfigService) {}

  get<T>(path: string, options?: AiRequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  post<T>(
    path: string,
    body?: unknown,
    options?: AiRequestOptions,
  ): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  delete<T>(path: string, options?: AiRequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, options);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: unknown,
    options: AiRequestOptions = {},
  ): Promise<T> {
    const aiUrl = this.configService.get<string>('AI_URL')?.replace(/\/$/, '');
    if (!aiUrl) throw new Error('AI service is not configured');

    const timeoutMs = this.getPositiveNumber(
      options.timeoutMs,
      this.configService.get<string | number>('AI_TIMEOUT_MS'),
      4500,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const token = this.configService.get<string>('AI_TOKEN');
      const response = await fetch(`${aiUrl}${this.normalizePath(path)}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        let responseText = '';
        try {
          responseText = await response.text();
        } catch {
          responseText = '';
        }
        throw new AiHttpError(
          `AI service returned HTTP ${response.status}`,
          response.status,
          responseText,
        );
      }

      if (options.parseJson === false) return undefined as T;
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizePath(path: string): string {
    return path.startsWith('/') ? path : `/${path}`;
  }

  private getPositiveNumber(
    primary: number | undefined,
    secondary: string | number | undefined,
    fallback: number,
  ): number {
    const value = Number(primary ?? secondary);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
