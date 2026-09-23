import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomInt, randomUUID } from 'crypto';
import Redis from 'ioredis';
import {
  PASSWORD_RESET_COOLDOWN_KEY_PREFIX,
  PASSWORD_RESET_OTP_KEY_PREFIX,
  PASSWORD_RESET_RATE_LIMIT_KEY_PREFIX,
  PASSWORD_RESET_TOKEN_KEY_PREFIX,
  REFRESH_SESSION_KEY_PREFIX,
} from '../../common/constants/auth.constant';
import { MailService } from '../mail/mail.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';

const RESET_OTP_TTL_SECONDS = 10 * 60;
const RESET_TOKEN_TTL_SECONDS = 10 * 60;
const RESEND_COOLDOWN_SECONDS = 60;
const REQUEST_RATE_LIMIT_SECONDS = 60 * 60;
const MAX_REQUESTS_PER_WINDOW = 5;
const OTP_SALT_ROUNDS = 10;

interface StoredResetOtp {
  hash: string;
  email: string;
  userId: string;
}

interface StoredResetToken {
  email: string;
  userId: string;
}

export interface PasswordResetRequestResult {
  email: string;
  expiresInSeconds: number;
  resendCooldownSeconds: number;
  emailDelivery: 'sent' | 'unavailable';
  message: string;
}

export interface PasswordResetVerifyResult {
  resetToken: string;
  expiresInSeconds: number;
}

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async requestOtp(email: string): Promise<PasswordResetRequestResult> {
    const normalizedEmail = this.normalizeEmail(email);

    await this.assertCanRequest(normalizedEmail);

    const user = await this.usersService.findByEmail(normalizedEmail);

    if (!user || user.status !== UserStatus.ACTIVE) {
      await this.setCooldown(normalizedEmail);
      return this.genericDispatchResult(normalizedEmail);
    }

    const otp = String(randomInt(100000, 1000000));
    const stored: StoredResetOtp = {
      hash: await bcrypt.hash(otp, OTP_SALT_ROUNDS),
      email: normalizedEmail,
      userId: user.id,
    };

    await this.redis.set(
      this.getOtpKey(normalizedEmail),
      JSON.stringify(stored),
      'EX',
      RESET_OTP_TTL_SECONDS,
    );

    try {
      await this.mailService.sendPasswordResetOtp(normalizedEmail, otp);
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) {
        throw error;
      }
    }

    await this.setCooldown(normalizedEmail);

    return this.genericDispatchResult(normalizedEmail);
  }

  async verifyOtp(
    email: string,
    otp: string,
  ): Promise<PasswordResetVerifyResult> {
    const normalizedEmail = this.normalizeEmail(email);
    const storedValue = await this.redis.get(this.getOtpKey(normalizedEmail));

    if (!storedValue) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    const stored = JSON.parse(storedValue) as StoredResetOtp;
    const isValid = await bcrypt.compare(otp, stored.hash);

    if (!isValid || stored.email !== normalizedEmail) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    const user = await this.usersService.findByEmail(normalizedEmail);

    if (
      !user ||
      user.id !== stored.userId ||
      user.status !== UserStatus.ACTIVE
    ) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    await this.redis.del(this.getOtpKey(normalizedEmail));

    const resetToken = randomUUID();
    const resetGrant: StoredResetToken = {
      email: normalizedEmail,
      userId: user.id,
    };

    await this.redis.set(
      this.getResetTokenKey(resetToken),
      JSON.stringify(resetGrant),
      'EX',
      RESET_TOKEN_TTL_SECONDS,
    );

    return { resetToken, expiresInSeconds: RESET_TOKEN_TTL_SECONDS };
  }

  async resetPassword(resetToken: string, newPassword: string): Promise<void> {
    const tokenKey = this.getResetTokenKey(resetToken);
    const storedValue = await this.redis.getdel(tokenKey);

    if (!storedValue) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const stored = JSON.parse(storedValue) as StoredResetToken;
    await this.usersService.resetPasswordById(stored.userId, newPassword);
    await this.revokeRefreshSessions(stored.userId);
  }

  private async assertCanRequest(email: string): Promise<void> {
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
      await this.redis.expire(rateLimitKey, REQUEST_RATE_LIMIT_SECONDS);
    }

    if (attempts > MAX_REQUESTS_PER_WINDOW) {
      throw new HttpException(
        'Too many OTP requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async setCooldown(email: string): Promise<void> {
    await this.redis.set(
      this.getCooldownKey(email),
      '1',
      'EX',
      RESEND_COOLDOWN_SECONDS,
    );
  }

  private async revokeRefreshSessions(userId: string): Promise<void> {
    const keys = await this.redis.keys(
      `${REFRESH_SESSION_KEY_PREFIX}:${userId}:*`,
    );

    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  private genericDispatchResult(email: string): PasswordResetRequestResult {
    return {
      email,
      expiresInSeconds: RESET_OTP_TTL_SECONDS,
      resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
      emailDelivery: 'sent',
      message:
        'If the email belongs to an eligible account, a password reset OTP has been sent.',
    };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private getOtpKey(email: string): string {
    return `${PASSWORD_RESET_OTP_KEY_PREFIX}:${email}`;
  }

  private getCooldownKey(email: string): string {
    return `${PASSWORD_RESET_COOLDOWN_KEY_PREFIX}:${email}`;
  }

  private getRateLimitKey(email: string): string {
    return `${PASSWORD_RESET_RATE_LIMIT_KEY_PREFIX}:${email}`;
  }

  private getResetTokenKey(resetToken: string): string {
    return `${PASSWORD_RESET_TOKEN_KEY_PREFIX}:${resetToken}`;
  }
}
