import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { EmailDeliveryService } from './email-delivery.service';
import { EmailVerificationService } from './email-verification.service';
import { UserRole, UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-otp'),
  compare: jest.fn(),
}));

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;
  let usersService: {
    findByEmail: jest.Mock;
    activatePendingUserByEmail: jest.Mock;
  };
  let emailDeliveryService: { sendVerificationOtp: jest.Mock };
  let redis: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    ttl: jest.Mock;
    incr: jest.Mock;
    expire: jest.Mock;
  };
  let compare: jest.Mock;

  const pendingUser = {
    id: 'user-id',
    name: 'Test User',
    email: 'test@example.com',
    password: 'hash',
    role: UserRole.LEARNER,
    status: UserStatus.PENDING_VERIFICATION,
    avatar: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    usersService = {
      findByEmail: jest.fn().mockResolvedValue(pendingUser),
      activatePendingUserByEmail: jest.fn().mockResolvedValue({
        ...pendingUser,
        status: UserStatus.ACTIVE,
      }),
    };
    emailDeliveryService = {
      sendVerificationOtp: jest.fn().mockResolvedValue({ delivered: true }),
    };
    redis = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      ttl: jest.fn().mockResolvedValue(-2),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    };
    compare = bcrypt.compare as jest.Mock;
    compare.mockResolvedValue(true);

    service = new EmailVerificationService(
      usersService as unknown as UsersService,
      emailDeliveryService as unknown as EmailDeliveryService,
      redis as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends initial OTP, stores only its hash, and never returns the OTP', async () => {
    const result = await service.sendInitialOtp(' Test@Example.COM ');

    expect(bcrypt.hash).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{6}$/),
      10,
    );
    expect(redis.set).toHaveBeenCalledWith(
      'auth:email-verification:otp:test@example.com',
      JSON.stringify({ hash: 'hashed-otp', email: 'test@example.com' }),
      'EX',
      600,
    );
    expect(emailDeliveryService.sendVerificationOtp).toHaveBeenCalledWith(
      'test@example.com',
      expect.stringMatching(/^\d{6}$/),
    );
    expect(result).toEqual({
      email: 'test@example.com',
      expiresInSeconds: 600,
      resendCooldownSeconds: 60,
      emailDelivery: 'sent',
    });
    expect(result).not.toHaveProperty('otp');
  });

  it('returns delivery unavailable when email sending is not configured', async () => {
    emailDeliveryService.sendVerificationOtp.mockResolvedValue({
      delivered: false,
    });

    await expect(
      service.sendInitialOtp(pendingUser.email),
    ).resolves.toMatchObject({
      emailDelivery: 'unavailable',
    });
  });

  it('verifies a valid OTP once and activates the pending account', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({ hash: 'hashed-otp', email: pendingUser.email }),
    );

    const result = await service.verifyOtp(pendingUser.email, '123456');

    expect(compare).toHaveBeenCalledWith('123456', 'hashed-otp');
    expect(redis.del).toHaveBeenCalledWith(
      'auth:email-verification:otp:test@example.com',
    );
    expect(usersService.activatePendingUserByEmail).toHaveBeenCalledWith(
      pendingUser.email,
    );
    expect(result.status).toBe(UserStatus.ACTIVE);
  });

  it('rejects invalid or expired OTP without activating the account', async () => {
    redis.get.mockResolvedValue(null);

    await expect(
      service.verifyOtp(pendingUser.email, '123456'),
    ).rejects.toEqual(new BadRequestException('Invalid or expired OTP'));
    expect(usersService.activatePendingUserByEmail).not.toHaveBeenCalled();
  });

  it('rejects already verified accounts as already-used OTP', async () => {
    usersService.findByEmail.mockResolvedValue({
      ...pendingUser,
      status: UserStatus.ACTIVE,
    });

    await expect(
      service.verifyOtp(pendingUser.email, '123456'),
    ).rejects.toEqual(new BadRequestException('OTP has already been used'));
  });

  it('rejects disabled accounts', async () => {
    usersService.findByEmail.mockResolvedValue({
      ...pendingUser,
      status: UserStatus.INACTIVE,
    });

    await expect(
      service.verifyOtp(pendingUser.email, '123456'),
    ).rejects.toEqual(new ForbiddenException('Account disabled'));
  });

  it('blocks resend during cooldown', async () => {
    redis.ttl.mockResolvedValue(45);

    await expect(service.resendOtp(pendingUser.email)).rejects.toEqual(
      new HttpException(
        'Please wait 45 seconds before requesting another OTP',
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );
  });

  it('rate limits repeated resends', async () => {
    redis.incr.mockResolvedValue(6);

    await expect(service.resendOtp(pendingUser.email)).rejects.toEqual(
      new HttpException('Too many OTP requests', HttpStatus.TOO_MANY_REQUESTS),
    );
  });
});
