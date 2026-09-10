import { createHmac, timingSafeEqual } from 'crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

const DEFAULT_SIGNATURE_TTL_SECONDS = 300;

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

@Injectable()
export class SePayAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const mode = this.configService.get<string>(
      'SEPAY_WEBHOOK_AUTH_MODE',
      'hmac',
    );

    if (mode === 'none') {
      return true;
    }

    const secret = this.configService.getOrThrow<string>(
      'SEPAY_WEBHOOK_AUTH_SECRET',
    );

    if (mode === 'apikey') {
      const authorization = request.headers.authorization ?? '';
      if (!authorization.startsWith('Apikey ')) {
        throw new UnauthorizedException('Missing SePay API key');
      }

      const supplied = authorization.slice('Apikey '.length);
      if (!safeEqual(supplied, secret)) {
        throw new UnauthorizedException('Invalid SePay API key');
      }

      return true;
    }

    const signature = request.headers['x-sepay-signature'];
    const timestamp = request.headers['x-sepay-timestamp'];
    if (typeof signature !== 'string' || typeof timestamp !== 'string') {
      throw new UnauthorizedException('Missing SePay signature headers');
    }

    const ttlSeconds = Number(
      this.configService.get<string>(
        'SEPAY_SIGNATURE_TTL_SECONDS',
        String(DEFAULT_SIGNATURE_TTL_SECONDS),
      ),
    );
    const ageMs = Math.abs(Date.now() - Number(timestamp) * 1000);
    if (Number.isNaN(ageMs) || ageMs > ttlSeconds * 1000) {
      throw new UnauthorizedException('SePay signature expired');
    }

    const rawBody = (request as Request & { rawBody?: unknown }).rawBody;
    if (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string') {
      throw new UnauthorizedException('Missing raw request body');
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!safeEqual(expected, signature)) {
      throw new UnauthorizedException('Invalid SePay signature');
    }

    return true;
  }
}
