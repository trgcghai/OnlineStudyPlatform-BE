import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomInt, randomUUID } from 'crypto';
import Redis from 'ioredis';
import { MailService } from '../mail/mail.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { UsersService } from '../users/users.service';
import { User, UserStatus } from '../users/entities/user.entity';
import { UserResponse } from '../users/dto/user.dto';
import {
  ACCESS_TOKEN_BLACKLIST_KEY_PREFIX,
  EMAIL_VERIFICATION_COOLDOWN_KEY_PREFIX,
  EMAIL_VERIFICATION_OTP_KEY_PREFIX,
  EMAIL_VERIFICATION_RATE_LIMIT_KEY_PREFIX,
  REFRESH_SESSION_KEY_PREFIX,
} from '../../common/constants/auth.constant';
import {
  RegisterDto,
  AccessTokenPayload,
  LoginDto,
  RefreshTokenPayload,
  ResetPasswordDto,
} from './dto/auth.dto';
import { PasswordResetService } from './password-reset.service';
import type {
  PasswordResetRequestResult,
  PasswordResetVerifyResult,
} from './password-reset.service';

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

export interface AuthTokenResult {
  accessToken: string;
  refreshToken: string;
  user: UserResponse;
}

export interface RegisterResult extends OtpDispatchResult {
  user: UserResponse;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly passwordResetService: PasswordResetService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async register(registerDto: RegisterDto): Promise<RegisterResult> {
    const user = await this.usersService.create(registerDto, {
      status: UserStatus.PENDING_VERIFICATION,
    });
    const dispatch = await this.issueEmailVerificationOtp(user.email, false);

    return { user, ...dispatch };
  }

  async verifyEmail(email: string, otp: string): Promise<UserResponse> {
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

    const otpKey = this.getEmailVerificationOtpKey(normalizedEmail);
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

  async resendEmailOtp(email: string): Promise<OtpDispatchResult> {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.usersService.findByEmail(normalizedEmail);

    if (!user || user.status !== UserStatus.PENDING_VERIFICATION) {
      return this.createOtpDispatchResult(normalizedEmail, 'unavailable');
    }

    return this.issueEmailVerificationOtp(normalizedEmail, true);
  }

  async requestPasswordResetOtp(
    email: string,
  ): Promise<PasswordResetRequestResult> {
    return this.passwordResetService.requestOtp(email);
  }

  async verifyPasswordResetOtp(
    email: string,
    otp: string,
  ): Promise<PasswordResetVerifyResult> {
    return this.passwordResetService.verifyOtp(email, otp);
  }

  async resetPassword(resetDto: ResetPasswordDto): Promise<{ reset: true }> {
    await this.passwordResetService.resetPassword(
      resetDto.resetToken,
      resetDto.newPassword,
    );

    return { reset: true };
  }

  async login(loginDto: LoginDto): Promise<AuthTokenResult> {
    const invalidCredentials = new UnauthorizedException(
      'Invalid email or password',
    );
    const user = await this.usersService.findByEmail(loginDto.email);

    if (!user) {
      throw invalidCredentials;
    }

    const isValidPassword = await bcrypt.compare(
      loginDto.password,
      user.password,
    );

    if (!isValidPassword) {
      throw invalidCredentials;
    }

    this.assertActiveUser(user);

    return this.issueTokens(user);
  }

  async refresh(refreshToken: string | undefined): Promise<AuthTokenResult> {
    if (!refreshToken) {
      throw new UnauthorizedException();
    }

    const payload = await this.verifyRefreshToken(refreshToken);
    const oldSessionKey = this.getRefreshSessionKey(
      payload.sub,
      payload.sessionId,
    );
    const session = await this.redis.getdel(oldSessionKey);

    if (!session) {
      throw new UnauthorizedException();
    }

    const user = await this.usersService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException();
    }

    this.assertActiveUser(user);

    return this.issueTokens(user);
  }

  async logout(
    refreshToken: string | undefined,
    accessToken?: string,
  ): Promise<void> {
    await this.blacklistAccessToken(accessToken);

    if (!refreshToken) return;

    try {
      const payload = await this.verifyRefreshToken(refreshToken);
      await this.redis.del(
        this.getRefreshSessionKey(payload.sub, payload.sessionId),
      );
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        return;
      }

      throw error;
    }
  }

  getRefreshCookieMaxAgeMs(): number {
    return (
      this.parseTtlToSeconds(
        this.configService.getOrThrow<string>('JWT_REFRESH_TTL'),
      ) * 1000
    );
  }

  isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  private async issueEmailVerificationOtp(
    email: string,
    enforceRateLimit: boolean,
  ): Promise<OtpDispatchResult> {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.usersService.findByEmail(normalizedEmail);

    if (!user || user.status !== UserStatus.PENDING_VERIFICATION) {
      throw new BadRequestException('Account is not pending verification');
    }

    if (enforceRateLimit) {
      await this.assertCanResendEmailVerificationOtp(normalizedEmail);
    }

    const otp = String(randomInt(100000, 1000000));
    const stored: StoredOtp = {
      hash: await bcrypt.hash(otp, OTP_SALT_ROUNDS),
      email: normalizedEmail,
    };

    await this.redis.set(
      this.getEmailVerificationOtpKey(normalizedEmail),
      JSON.stringify(stored),
      'EX',
      OTP_TTL_SECONDS,
    );

    let delivery: OtpDispatchResult['emailDelivery'] = 'sent';

    try {
      const result = await this.mailService.sendVerificationOtp(
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
      this.getEmailVerificationCooldownKey(normalizedEmail),
      '1',
      'EX',
      RESEND_COOLDOWN_SECONDS,
    );

    return this.createOtpDispatchResult(normalizedEmail, delivery);
  }

  private async assertCanResendEmailVerificationOtp(
    email: string,
  ): Promise<void> {
    const cooldownTtl = await this.redis.ttl(
      this.getEmailVerificationCooldownKey(email),
    );

    if (cooldownTtl > 0) {
      throw new HttpException(
        `Please wait ${cooldownTtl} seconds before requesting another OTP`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const rateLimitKey = this.getEmailVerificationRateLimitKey(email);
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

  private createOtpDispatchResult(
    email: string,
    emailDelivery: OtpDispatchResult['emailDelivery'],
  ): OtpDispatchResult {
    return {
      email,
      expiresInSeconds: OTP_TTL_SECONDS,
      resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
      emailDelivery,
    };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private getEmailVerificationOtpKey(email: string): string {
    return `${EMAIL_VERIFICATION_OTP_KEY_PREFIX}:${email}`;
  }

  private getEmailVerificationCooldownKey(email: string): string {
    return `${EMAIL_VERIFICATION_COOLDOWN_KEY_PREFIX}:${email}`;
  }

  private getEmailVerificationRateLimitKey(email: string): string {
    return `${EMAIL_VERIFICATION_RATE_LIMIT_KEY_PREFIX}:${email}`;
  }

  private async issueTokens(user: User): Promise<AuthTokenResult> {
    const sessionId = randomUUID();
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      sessionId,
    };
    const accessSecret =
      this.configService.getOrThrow<string>('JWT_ACCESS_SECRET');
    const accessTtl = this.configService.getOrThrow<string>('JWT_ACCESS_TTL');
    const refreshSecret =
      this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
    const refreshTtl = this.configService.getOrThrow<string>('JWT_REFRESH_TTL');
    this.parseTtlToSeconds(accessTtl);
    const refreshTtlSeconds = this.parseTtlToSeconds(refreshTtl);
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: accessSecret,
        expiresIn: accessTtl as JwtSignOptions['expiresIn'],
        jwtid: randomUUID(),
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: refreshSecret,
        expiresIn: refreshTtl as JwtSignOptions['expiresIn'],
      }),
    ]);

    await this.redis.set(
      this.getRefreshSessionKey(user.id, sessionId),
      user.id,
      'EX',
      refreshTtlSeconds,
    );

    return {
      accessToken,
      refreshToken,
      user: this.toAuthUserResponse(user),
    };
  }

  private assertActiveUser(user: User): void {
    if (user.status === UserStatus.PENDING_VERIFICATION) {
      throw new ForbiddenException('Email verification required');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Account disabled');
    }
  }

  private getRefreshSessionKey(userId: string, sessionId: string): string {
    return `${REFRESH_SESSION_KEY_PREFIX}:${userId}:${sessionId}`;
  }

  private getAccessBlacklistKey(jti: string): string {
    return `${ACCESS_TOKEN_BLACKLIST_KEY_PREFIX}:${jti}`;
  }

  private async blacklistAccessToken(
    accessToken: string | undefined,
  ): Promise<void> {
    if (!accessToken) return;

    const payload = await this.verifyAccessTokenForBlacklist(accessToken);

    if (!payload?.jti || !payload.exp) return;

    const ttlSeconds = payload.exp - Math.floor(Date.now() / 1000);

    if (ttlSeconds <= 0) return;

    await this.redis.set(
      this.getAccessBlacklistKey(payload.jti),
      payload.sub,
      'EX',
      ttlSeconds,
    );
  }

  private parseTtlToSeconds(ttl: string): number {
    const match = ttl.trim().match(/^(\d+)([smhd])$/i);

    if (!match) {
      throw new InternalServerErrorException('Invalid token TTL configuration');
    }

    const value = Number(match[1]);
    const unit = match[2].toLowerCase();

    if (value <= 0) {
      throw new InternalServerErrorException('Invalid token TTL configuration');
    }

    const multipliers: Record<string, number> = {
      s: 1,
      m: 60,
      h: 60 * 60,
      d: 24 * 60 * 60,
    };

    return value * multipliers[unit];
  }

  private toAuthUserResponse(user: User): UserResponse {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private async verifyRefreshToken(
    refreshToken: string,
  ): Promise<RefreshTokenPayload> {
    const refreshSecret =
      this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');

    try {
      return await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        {
          secret: refreshSecret,
        },
      );
    } catch {
      throw new UnauthorizedException();
    }
  }

  private async verifyAccessTokenForBlacklist(
    accessToken: string,
  ): Promise<AccessTokenPayload | null> {
    const accessSecret =
      this.configService.getOrThrow<string>('JWT_ACCESS_SECRET');

    try {
      return await this.jwtService.verifyAsync<AccessTokenPayload>(
        accessToken,
        {
          secret: accessSecret,
        },
      );
    } catch {
      return null;
    }
  }
}
