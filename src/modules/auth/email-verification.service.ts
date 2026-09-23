import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { EmailDeliveryService } from './email-delivery.service';

const OTP_TTL_SECONDS = 10 * 60;
const RESEND_COOLDOWN_SECONDS = 60;
const RESEND_RATE_LIMIT_SECONDS = 60 * 60;
const MAX_RESENDS_PER_WINDOW = 5;
const OTP_SALT_ROUNDS = 10;

interface StoredOtp {
  hash: string;
  email: string;
}

export interface OtpDispatchResult {
  email: string;
  expiresInSeconds: number;
  resendCooldownSeconds: number;
  emailDelivery: 'sent' | 'unavailable';
}

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly usersService: UsersService,
    private readonly emailDeliveryService: EmailDeliveryService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async sendInitialOtp(email: string): Promise<OtpDispatchResult> {
    return this.issueOtp(email, { enforceRateLimit: false });
  }

  async resendOtp(email: string): Promise<OtpDispatchResult> {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.usersService.findByEmail(normalizedEmail);

    if (!user || user.status !== UserStatus.PENDING_VERIFICATION) {
      return this.genericDispatchResult(normalizedEmail, 'unavailable');
    }

    return this.issueOtp(normalizedEmail, { enforceRateLimit: true });
  }

  async verifyOtp(email: string, otp: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.usersService.findByEmail(normalizedEmail);

    if (!user) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    if (user.status === UserStatus.ACTIVE) {
      throw new BadRequestException('OTP has already been used');
    }

    if (user.status !== UserStatus.PENDING_VERIFICATION) {
      throw new ForbiddenException('Account disabled');
    }

    const otpKey = this.getOtpKey(normalizedEmail);
    const storedValue = await this.redis.get(otpKey);

    if (!storedValue) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    const stored = JSON.parse(storedValue) as StoredOtp;
    const isValid = await bcrypt.compare(otp, stored.hash);

    if (!isValid) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    await this.redis.del(otpKey);

    return this.usersService.activatePendingUserByEmail(stored.email);
  }

  private async issueOtp(
    email: string,
    options: { enforceRateLimit: boolean },
  ): Promise<OtpDispatchResult> {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.usersService.findByEmail(normalizedEmail);

    if (!user || user.status !== UserStatus.PENDING_VERIFICATION) {
      throw new BadRequestException('Account is not pending verification');
    }

    if (options.enforceRateLimit) {
      await this.assertCanResend(normalizedEmail);
    }

    const otp = String(randomInt(100000, 1000000));
    const stored: StoredOtp = {
      hash: await bcrypt.hash(otp, OTP_SALT_ROUNDS),
      email: normalizedEmail,
    };

    await this.redis.set(
      this.getOtpKey(normalizedEmail),
      JSON.stringify(stored),
      'EX',
      OTP_TTL_SECONDS,
    );

    let delivery: 'sent' | 'unavailable' = 'sent';
    try {
      const result = await this.emailDeliveryService.sendVerificationOtp(
        normalizedEmail,
        otp,
      );
      delivery = result.delivered ? 'sent' : 'unavailable';
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        delivery = 'unavailable';
      } else {
        throw error;
      }
    }

    await this.redis.set(
      this.getCooldownKey(normalizedEmail),
      '1',
      'EX',
      RESEND_COOLDOWN_SECONDS,
    );

    return this.genericDispatchResult(normalizedEmail, delivery);
  }

  private async assertCanResend(email: string): Promise<void> {
    const cooldownTtl = await this.redis.ttl(this.getCooldownKey(email));

    if (cooldownTtl > 0) {
      throw new HttpException(
        `Please wait ${cooldownTtl} seconds before requesting another OTP`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const rateLimitKey = this.getRateLimitKey(email);
    const attempts = await this.redis.incr(rateLimitKey);

    if (attempts === 1) {
      await this.redis.expire(rateLimitKey, RESEND_RATE_LIMIT_SECONDS);
    }

    if (attempts > MAX_RESENDS_PER_WINDOW) {
      throw new HttpException(
        'Too many OTP requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private genericDispatchResult(
    email: string,
    delivery: 'sent' | 'unavailable',
  ): OtpDispatchResult {
    return {
      email,
      expiresInSeconds: OTP_TTL_SECONDS,
      resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
      emailDelivery: delivery,
    };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private getOtpKey(email: string): string {
    return `auth:email-verification:otp:${email}`;
  }

  private getCooldownKey(email: string): string {
    return `auth:email-verification:cooldown:${email}`;
  }

  private getRateLimitKey(email: string): string {
    return `auth:email-verification:rate:${email}`;
  }
}
