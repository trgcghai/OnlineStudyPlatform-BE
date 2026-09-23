import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { MailService } from '../mail/mail.service';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-otp'),
  compare: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let usersService: {
    create: jest.Mock;
    findByEmail: jest.Mock;
    findById: jest.Mock;
    activatePendingUserByEmail: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let configService: { getOrThrow: jest.Mock };
  let mailService: { sendVerificationOtp: jest.Mock };
  let redis: {
    get: jest.Mock;
    set: jest.Mock;
    getdel: jest.Mock;
    del: jest.Mock;
    ttl: jest.Mock;
    incr: jest.Mock;
    expire: jest.Mock;
  };
  let compare: jest.Mock;

  const user = {
    id: 'user-id',
    name: 'Test User',
    email: 'test@example.com',
    password: '$2b$10$hash',
    role: UserRole.LEARNER,
    avatar: null,
    status: UserStatus.ACTIVE,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  } as User;

  const safeUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };

  beforeEach(() => {
    usersService = {
      create: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
      activatePendingUserByEmail: jest.fn(),
    };
    jwtService = {
      signAsync: jest.fn((payload: { sessionId?: string }) =>
        Promise.resolve(payload.sessionId ? 'refresh-token' : 'access-token'),
      ),
      verifyAsync: jest.fn(),
    };
    configService = {
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, string> = {
          JWT_ACCESS_SECRET: 'access-secret',
          JWT_ACCESS_TTL: '15m',
          JWT_REFRESH_SECRET: 'refresh-secret',
          JWT_REFRESH_TTL: '7d',
        };

        return values[key];
      }),
    };
    mailService = {
      sendVerificationOtp: jest.fn().mockResolvedValue({ delivered: true }),
    };
    redis = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      getdel: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      ttl: jest.fn().mockResolvedValue(-2),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    };
    compare = bcrypt.compare as jest.Mock;
    compare.mockResolvedValue(true);

    service = new AuthService(
      usersService as unknown as UsersService,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
      mailService as unknown as MailService,
      redis as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('valid login issues tokens, safe user, and stores Redis refresh session', async () => {
    usersService.findByEmail.mockResolvedValue(user);

    const result = await service.login({
      email: 'test@example.com',
      password: 'Password123!',
    });

    expect(result).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: safeUser,
    });
    expect(result.user).not.toHaveProperty('password');
    expect(compare).toHaveBeenCalledWith('Password123!', user.password);
    expect(jwtService.signAsync).toHaveBeenNthCalledWith(
      1,
      { sub: user.id, email: user.email, role: user.role },
      {
        secret: 'access-secret',
        expiresIn: '15m',
        jwtid: expect.any(String),
      },
    );
    expect(jwtService.signAsync).toHaveBeenNthCalledWith(
      2,
      { sub: user.id, sessionId: expect.any(String) },
      { secret: 'refresh-secret', expiresIn: '7d' },
    );
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:refresh:user-id:.+$/),
      user.id,
      'EX',
      604800,
    );
  });

  it('register creates a pending user and sends an email verification OTP', async () => {
    const pendingUser = {
      ...safeUser,
      status: UserStatus.PENDING_VERIFICATION,
    };
    usersService.create.mockResolvedValue(pendingUser);
    usersService.findByEmail.mockResolvedValue(pendingUser);

    const result = await service.register({
      name: user.name,
      email: user.email,
      password: 'Password123!',
    });

    expect(usersService.create).toHaveBeenCalledWith(
      { name: user.name, email: user.email, password: 'Password123!' },
      { status: UserStatus.PENDING_VERIFICATION },
    );
    expect(bcrypt.hash).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{6}$/),
      10,
    );
    expect(redis.set).toHaveBeenCalledWith(
      'auth:email-verification:otp:test@example.com',
      JSON.stringify({ hash: 'hashed-otp', email: user.email }),
      'EX',
      600,
    );
    expect(mailService.sendVerificationOtp).toHaveBeenCalledWith(
      user.email,
      expect.stringMatching(/^\d{6}$/),
    );
    expect(result).toEqual({
      user: pendingUser,
      email: user.email,
      expiresInSeconds: 600,
      resendCooldownSeconds: 60,
      emailDelivery: 'sent',
    });
  });

  it('verifies a valid OTP once and activates the pending account', async () => {
    const pendingUser = {
      ...user,
      status: UserStatus.PENDING_VERIFICATION,
    };
    usersService.findByEmail.mockResolvedValue(pendingUser);
    usersService.activatePendingUserByEmail.mockResolvedValue(safeUser);
    redis.get.mockResolvedValue(
      JSON.stringify({ hash: 'hashed-otp', email: user.email }),
    );

    await expect(service.verifyEmail(user.email, '123456')).resolves.toBe(
      safeUser,
    );
    expect(compare).toHaveBeenCalledWith('123456', 'hashed-otp');
    expect(redis.del).toHaveBeenCalledWith(
      'auth:email-verification:otp:test@example.com',
    );
    expect(usersService.activatePendingUserByEmail).toHaveBeenCalledWith(
      user.email,
    );
  });

  it('resends an OTP for a pending account', async () => {
    usersService.findByEmail.mockResolvedValue({
      ...user,
      status: UserStatus.PENDING_VERIFICATION,
    });

    await expect(service.resendEmailOtp(user.email)).resolves.toEqual({
      email: user.email,
      expiresInSeconds: 600,
      resendCooldownSeconds: 60,
      emailDelivery: 'sent',
    });
    expect(redis.ttl).toHaveBeenCalledWith(
      'auth:email-verification:cooldown:test@example.com',
    );
    expect(redis.incr).toHaveBeenCalledWith(
      'auth:email-verification:rate:test@example.com',
    );
    expect(mailService.sendVerificationOtp).toHaveBeenCalledWith(
      user.email,
      expect.stringMatching(/^\d{6}$/),
    );
  });

  it('rejects an invalid or expired OTP', async () => {
    usersService.findByEmail.mockResolvedValue({
      ...user,
      status: UserStatus.PENDING_VERIFICATION,
    });
    redis.get.mockResolvedValue(null);

    await expect(service.verifyEmail(user.email, '123456')).rejects.toEqual(
      new BadRequestException('Invalid or expired OTP'),
    );
    expect(usersService.activatePendingUserByEmail).not.toHaveBeenCalled();
  });

  it('rejects an OTP for an already verified account', async () => {
    usersService.findByEmail.mockResolvedValue(user);

    await expect(service.verifyEmail(user.email, '123456')).rejects.toEqual(
      new BadRequestException('OTP has already been used'),
    );
  });

  it('blocks OTP resend during cooldown', async () => {
    usersService.findByEmail.mockResolvedValue({
      ...user,
      status: UserStatus.PENDING_VERIFICATION,
    });
    redis.ttl.mockResolvedValue(45);

    await expect(service.resendEmailOtp(user.email)).rejects.toEqual(
      new HttpException(
        'Please wait 45 seconds before requesting another OTP',
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );
  });

  it('rate limits repeated OTP resends', async () => {
    usersService.findByEmail.mockResolvedValue({
      ...user,
      status: UserStatus.PENDING_VERIFICATION,
    });
    redis.incr.mockResolvedValue(6);

    await expect(service.resendEmailOtp(user.email)).rejects.toEqual(
      new HttpException('Too many OTP requests', HttpStatus.TOO_MANY_REQUESTS),
    );
  });

  it('rejects login when user is missing', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    await expect(
      service.login({ email: 'missing@example.com', password: 'Password123!' }),
    ).rejects.toEqual(new UnauthorizedException('Invalid email or password'));
  });

  it('rejects login when password is wrong', async () => {
    usersService.findByEmail.mockResolvedValue(user);
    compare.mockResolvedValue(false);

    await expect(
      service.login({ email: user.email, password: 'wrong-password' }),
    ).rejects.toEqual(new UnauthorizedException('Invalid email or password'));
  });

  it('rejects login when user is inactive', async () => {
    usersService.findByEmail.mockResolvedValue({
      ...user,
      status: UserStatus.INACTIVE,
    });

    await expect(
      service.login({ email: user.email, password: 'Password123!' }),
    ).rejects.toEqual(new ForbiddenException('Account disabled'));
  });

  it('rejects login when email verification is pending', async () => {
    usersService.findByEmail.mockResolvedValue({
      ...user,
      status: UserStatus.PENDING_VERIFICATION,
    });

    await expect(
      service.login({ email: user.email, password: 'Password123!' }),
    ).rejects.toEqual(new ForbiddenException('Email verification required'));
  });

  it('refresh verifies token, checks session, reloads user, rotates session, and returns new tokens', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: user.id,
      sessionId: 'old',
    });
    jwtService.signAsync.mockImplementation((payload: { sessionId?: string }) =>
      Promise.resolve(
        payload.sessionId ? `refresh-${payload.sessionId}` : 'access-token',
      ),
    );
    redis.getdel.mockResolvedValue(user.id);
    usersService.findById.mockResolvedValue(user);

    const result = await service.refresh('old-refresh-token');

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('old-refresh-token', {
      secret: 'refresh-secret',
    });
    expect(redis.getdel).toHaveBeenCalledWith('auth:refresh:user-id:old');
    expect(usersService.findById).toHaveBeenCalledWith(user.id);
    expect(redis.del).not.toHaveBeenCalledWith('auth:refresh:user-id:old');
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:refresh:user-id:.+$/),
      user.id,
      'EX',
      604800,
    );
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toMatch(/^refresh-/);
    expect(result.refreshToken).not.toBe('refresh-old');
    expect(result.user).toEqual(safeUser);
  });

  it('rejects refresh when token is missing', async () => {
    await expect(service.refresh(undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it('rejects refresh when token is invalid', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid token'));

    await expect(service.refresh('bad-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(redis.getdel).not.toHaveBeenCalled();
    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('propagates refresh token config errors during refresh', async () => {
    const configError = new Error('Missing JWT_REFRESH_SECRET');
    configService.getOrThrow.mockImplementation((key: string) => {
      if (key === 'JWT_REFRESH_SECRET') {
        throw configError;
      }

      return 'unused';
    });

    await expect(service.refresh('refresh-token')).rejects.toBe(configError);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it('rejects refresh when Redis session is missing', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: user.id,
      sessionId: 'old',
    });
    redis.getdel.mockResolvedValue(null);

    await expect(service.refresh('old-refresh-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(redis.getdel).toHaveBeenCalledWith('auth:refresh:user-id:old');
    expect(usersService.findById).not.toHaveBeenCalled();
    expect(jwtService.signAsync).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('rejects refresh when user no longer exists', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: user.id,
      sessionId: 'old',
    });
    redis.getdel.mockResolvedValue(user.id);
    usersService.findById.mockResolvedValue(null);

    await expect(service.refresh('old-refresh-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(redis.getdel).toHaveBeenCalledWith('auth:refresh:user-id:old');
    expect(usersService.findById).toHaveBeenCalledWith(user.id);
    expect(redis.del).not.toHaveBeenCalled();
    expect(jwtService.signAsync).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('rejects refresh when user is inactive', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: user.id,
      sessionId: 'old',
    });
    redis.getdel.mockResolvedValue(user.id);
    usersService.findById.mockResolvedValue({
      ...user,
      status: UserStatus.INACTIVE,
    });

    await expect(service.refresh('old-refresh-token')).rejects.toEqual(
      new ForbiddenException('Account disabled'),
    );
    expect(redis.getdel).toHaveBeenCalledWith('auth:refresh:user-id:old');
    expect(usersService.findById).toHaveBeenCalledWith(user.id);
    expect(redis.del).not.toHaveBeenCalled();
    expect(jwtService.signAsync).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('rejects refresh when email verification is pending', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: user.id,
      sessionId: 'old',
    });
    redis.getdel.mockResolvedValue(user.id);
    usersService.findById.mockResolvedValue({
      ...user,
      status: UserStatus.PENDING_VERIFICATION,
    });

    await expect(service.refresh('old-refresh-token')).rejects.toEqual(
      new ForbiddenException('Email verification required'),
    );
  });

  it('rejects invalid token TTL configuration', async () => {
    configService.getOrThrow.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        JWT_ACCESS_SECRET: 'access-secret',
        JWT_ACCESS_TTL: '900',
        JWT_REFRESH_SECRET: 'refresh-secret',
        JWT_REFRESH_TTL: '7d',
      };

      return values[key];
    });
    usersService.findByEmail.mockResolvedValue(user);

    await expect(
      service.login({ email: user.email, password: 'Password123!' }),
    ).rejects.toEqual(
      new InternalServerErrorException('Invalid token TTL configuration'),
    );
    expect(jwtService.signAsync).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('rejects zero token TTL configuration', async () => {
    configService.getOrThrow.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        JWT_ACCESS_SECRET: 'access-secret',
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_SECRET: 'refresh-secret',
        JWT_REFRESH_TTL: '0d',
      };

      return values[key];
    });
    usersService.findByEmail.mockResolvedValue(user);

    await expect(
      service.login({ email: user.email, password: 'Password123!' }),
    ).rejects.toEqual(
      new InternalServerErrorException('Invalid token TTL configuration'),
    );
    expect(jwtService.signAsync).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('logout with a valid token deletes the Redis session', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: user.id,
      sessionId: 'old',
    });

    await expect(service.logout('refresh-token')).resolves.toBeUndefined();

    expect(redis.del).toHaveBeenCalledWith('auth:refresh:user-id:old');
  });

  it('logout blacklists a valid access token until it expires', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    jwtService.verifyAsync
      .mockResolvedValueOnce({
        sub: user.id,
        email: user.email,
        role: user.role,
        jti: 'access-jti',
        exp: 1_700_000_900,
      })
      .mockResolvedValueOnce({
        sub: user.id,
        sessionId: 'old',
      });

    await expect(
      service.logout('refresh-token', 'access-token'),
    ).resolves.toBeUndefined();

    expect(jwtService.verifyAsync).toHaveBeenNthCalledWith(1, 'access-token', {
      secret: 'access-secret',
    });
    expect(redis.set).toHaveBeenCalledWith(
      'auth:access:blacklist:access-jti',
      user.id,
      'EX',
      900,
    );
    expect(redis.del).toHaveBeenCalledWith('auth:refresh:user-id:old');
  });

  it('logout skips access blacklist when access token is invalid', async () => {
    jwtService.verifyAsync
      .mockRejectedValueOnce(new Error('invalid access token'))
      .mockResolvedValueOnce({
        sub: user.id,
        sessionId: 'old',
      });

    await expect(
      service.logout('refresh-token', 'bad-access-token'),
    ).resolves.toBeUndefined();

    expect(redis.set).not.toHaveBeenCalledWith(
      expect.stringMatching(/^auth:access:blacklist:/),
      expect.anything(),
      'EX',
      expect.any(Number),
    );
    expect(redis.del).toHaveBeenCalledWith('auth:refresh:user-id:old');
  });

  it('logout without a token resolves and does not delete', async () => {
    await expect(service.logout(undefined)).resolves.toBeUndefined();

    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('logout with an invalid token resolves and does not delete', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid token'));

    await expect(service.logout('bad-token')).resolves.toBeUndefined();

    expect(redis.del).not.toHaveBeenCalled();
  });

  it('propagates refresh token config errors during logout', async () => {
    const configError = new Error('Missing JWT_REFRESH_SECRET');
    configService.getOrThrow.mockImplementation((key: string) => {
      if (key === 'JWT_REFRESH_SECRET') {
        throw configError;
      }

      return 'unused';
    });

    await expect(service.logout('refresh-token')).rejects.toBe(configError);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });
});
