import { ConfigService } from '@nestjs/config';
import {
  AiHttpClientService,
  AiHttpError,
} from './ai-http-client.service';

describe('AiHttpClientService', () => {
  const originalFetch = global.fetch;
  let configService: { get: jest.Mock };
  let service: AiHttpClientService;

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'AI_URL') return 'http://ai:8000/';
        if (key === 'AI_TOKEN') return 'secret';
        if (key === 'AI_TIMEOUT_MS') return 4500;
        return undefined;
      }),
    };
    service = new AiHttpClientService(
      configService as unknown as ConfigService,
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ ok: true }),
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('joins the configured AI URL with the request path', async () => {
    await service.get('/health');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://ai:8000/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('sends JSON body and bearer token for POST requests', async () => {
    await service.post('/chat', { message: 'hello' });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://ai:8000/chat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret',
        }),
        body: JSON.stringify({ message: 'hello' }),
      }),
    );
  });

  it('throws when AI_URL is not configured', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'AI_TOKEN') return 'secret';
      return undefined;
    });

    await expect(service.get('/health')).rejects.toThrow(
      'AI service is not configured',
    );
  });

  it('throws a status-aware error on non-2xx responses', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: jest.fn().mockResolvedValue('unavailable'),
    });

    await expect(service.get('/health')).rejects.toMatchObject({
      message: 'AI service returned HTTP 503',
      status: 503,
    });
    await expect(service.get('/health')).rejects.toBeInstanceOf(AiHttpError);
  });

  it('supports DELETE requests without a request body', async () => {
    await service.delete('/knowledge/sources/source-1');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://ai:8000/knowledge/sources/source-1',
      expect.objectContaining({
        method: 'DELETE',
        body: undefined,
      }),
    );
  });
});
