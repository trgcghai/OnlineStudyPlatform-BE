import {
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { UsersService } from '../users/users.service';
import { User, UserStatus } from '../users/entities/user.entity';
import { RegisterUserResponse } from '../users/dto/user.dto';
import {
  ACCESS_TOKEN_BLACKLIST_KEY_PREFIX,
  REFRESH_SESSION_KEY_PREFIX,
} from '../../common/constants/auth.constant';
import {
  AccessTokenPayload,
  LoginDto,
  RefreshTokenPayload,
} from './dto/auth.dto';

export interface AuthTokenResult {
  accessToken: string;
  refreshToken: string;
  user: RegisterUserResponse;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

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

  private toAuthUserResponse(user: User): RegisterUserResponse {
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
