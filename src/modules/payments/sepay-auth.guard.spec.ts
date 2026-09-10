import { createHmac } from 'crypto';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { SePayAuthGuard } from './sepay-auth.guard';

describe('SePayAuthGuard', () => {
  let guard: SePayAuthGuard;
  let configService: { get: jest.Mock; getOrThrow: jest.Mock };

  const secret = 'super-secret-webhook-key';

  const buildContext = (request: Request): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as unknown as ExecutionContext;

  const makeRequest = (overrides: Partial<Request> = {}): Request =>
    ({
      headers: {},
      rawBody: Buffer.from(JSON.stringify({ transferType: 'in' })),
      ...overrides,
    }) as unknown as Request;

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string, fallback: unknown) => fallback),
      getOrThrow: jest.fn(() => secret),
    };
    guard = new SePayAuthGuard(configService as unknown as ConfigService);
  });

  it('passes when auth mode is none', () => {
    configService.get.mockReturnValue('none');

    expect(guard.canActivate(buildContext(makeRequest()))).toBe(true);
    expect(configService.getOrThrow).not.toHaveBeenCalled();
  });

  describe('apikey mode', () => {
    beforeEach(() => {
      configService.get.mockReturnValue('apikey');
    });

    it('passes with a valid API key', () => {
      const request = makeRequest({
        headers: { authorization: `Apikey ${secret}` },
      });

      expect(guard.canActivate(buildContext(request))).toBe(true);
    });

    it('rejects an invalid API key', () => {
      const request = makeRequest({
        headers: { authorization: 'Apikey wrong-key' },
      });

      expect(() => guard.canActivate(buildContext(request))).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a missing Authorization header', () => {
      expect(() => guard.canActivate(buildContext(makeRequest()))).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('hmac mode', () => {
    beforeEach(() => {
      configService.get.mockReturnValue('hmac');
    });

    const bufferFrom = (request: Request): Buffer =>
      (request as Request & { rawBody: Buffer }).rawBody;

    const buildSignedRequest = (): Request => {
      const rawBody = bufferFrom(makeRequest());
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');

      return makeRequest({
        headers: {
          'x-sepay-signature': signature,
          'x-sepay-timestamp': String(timestamp),
        },
      });
    };

    it('passes with a valid HMAC signature', () => {
      const request = buildSignedRequest();

      expect(guard.canActivate(buildContext(request))).toBe(true);
    });

    it('rejects a mismatched signature', () => {
      const request = makeRequest({
        headers: {
          'x-sepay-signature': 'deadbeef',
          'x-sepay-timestamp': String(Math.floor(Date.now() / 1000)),
        },
      });

      expect(() => guard.canActivate(buildContext(request))).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when signature headers are missing', () => {
      expect(() => guard.canActivate(buildContext(makeRequest()))).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when the signature is older than the TTL window', () => {
      configService.get.mockImplementation((key: string, fallback: unknown) => {
        if (key === 'SEPAY_SIGNATURE_TTL_SECONDS') return '300';
        return fallback;
      });
      const staleTimestamp = String(
        Math.floor((Date.now() - 10 * 60 * 1000) / 1000),
      );
      const signature = createHmac('sha256', secret)
        .update(bufferFrom(makeRequest()))
        .digest('hex');
      const request = makeRequest({
        headers: {
          'x-sepay-signature': signature,
          'x-sepay-timestamp': staleTimestamp,
        },
      });

      expect(() => guard.canActivate(buildContext(request))).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when the raw body is missing', () => {
      const signature = createHmac('sha256', secret).update('').digest('hex');
      const request = makeRequest({
        headers: {
          'x-sepay-signature': signature,
          'x-sepay-timestamp': String(Math.floor(Date.now() / 1000)),
        },
        rawBody: undefined,
      });

      expect(() => guard.canActivate(buildContext(request))).toThrow(
        UnauthorizedException,
      );
    });
  });
});
