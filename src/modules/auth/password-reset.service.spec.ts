import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { MailService } from '../mail/mail.service';
import { PasswordResetService } from './password-reset.service';
import { UserRole, UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-otp'),
  compare: jest.fn(),
}));

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let usersService: {
    findByEmail: jest.Mock;
    resetPasswordById: jest.Mock;
  };
  let mailService: { sendPasswordResetOtp: jest.Mock };
  let redis: {
    get: jest.Mock;
    getdel: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    ttl: jest.Mock;
    incr: jest.Mock;
    expire: jest.Mock;
    keys: jest.Mock;
  };
  let compare: jest.Mock;

  const user = {
    id: 'user-id',
    name: 'Test User',
    email: 'test@example.com',
    password: 'hash',
    role: UserRole.LEARNER,
    status: UserStatus.ACTIVE,
    avatar: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    usersService = {
      findByEmail: jest.fn().mockResolvedValue(user),
      resetPasswordById: jest.fn().mockResolvedValue(undefined),
    };
    mailService = {
      sendPasswordResetOtp: jest.fn().mockResolvedValue({ delivered: true }),
    };
    redis = {
      get: jest.fn(),
      getdel: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      ttl: jest.fn().mockResolvedValue(-2),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      keys: jest.fn().mockResolvedValue([]),
    };
    compare = bcrypt.compare as jest.Mock;
    compare.mockResolvedValue(true);

    service = new PasswordResetService(
      usersService as unknown as UsersService,
      mailService as unknown as MailService,
      redis as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns a generic response while sending a reset OTP for eligible accounts', async () => {
    const result = await service.requestOtp(' Test@Example.COM ');

    expect(bcrypt.hash).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{6}$/),
      10,
    );
    expect(redis.set).toHaveBeenCalledWith(
      'auth:password-reset:otp:test@example.com',
      JSON.stringify({
        hash: 'hashed-otp',
        email: 'test@example.com',
        userId: user.id,
      }),
      'EX',
      600,
    );
    expect(mailService.sendPasswordResetOtp).toHaveBeenCalledWith(
      'test@example.com',
      expect.stringMatching(/^\d{6}$/),
    );
    expect(result).toEqual({
      email: 'test@example.com',
      expiresInSeconds: 600,
      resendCooldownSeconds: 60,
      emailDelivery: 'sent',
      message:
        'If the email belongs to an eligible account, a password reset OTP has been sent.',
    });
    expect(result).not.toHaveProperty('otp');
  });

  it('keeps the request response generic for missing accounts', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    const result = await service.requestOtp('missing@example.com');

    expect(mailService.sendPasswordResetOtp).not.toHaveBeenCalled();
    expect(result).toEqual({
      email: 'missing@example.com',
      expiresInSeconds: 600,
      resendCooldownSeconds: 60,
      emailDelivery: 'sent',
      message:
        'If the email belongs to an eligible account, a password reset OTP has been sent.',
    });
  });

  it('keeps the request response generic when SMTP delivery is unavailable', async () => {
    mailService.sendPasswordResetOtp.mockResolvedValue({
      delivered: false,
    });

    await expect(service.requestOtp(user.email)).resolves.toEqual({
      email: user.email,
      expiresInSeconds: 600,
      resendCooldownSeconds: 60,
      emailDelivery: 'sent',
      message:
        'If the email belongs to an eligible account, a password reset OTP has been sent.',
    });
  });

  it('verifies a valid OTP once and returns a short-lived reset token', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        hash: 'hashed-otp',
        email: user.email,
        userId: user.id,
      }),
    );

    const result = await service.verifyOtp(user.email, '123456');

    expect(compare).toHaveBeenCalledWith('123456', 'hashed-otp');
    expect(redis.del).toHaveBeenCalledWith(
      'auth:password-reset:otp:test@example.com',
    );
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:password-reset:token:.+$/),
      JSON.stringify({ email: user.email, userId: user.id }),
      'EX',
      600,
    );
    expect(result.resetToken).toEqual(expect.any(String));
    expect(result.expiresInSeconds).toBe(600);
  });

  it('rejects invalid or expired OTP without issuing a reset token', async () => {
    redis.get.mockResolvedValue(null);

    await expect(service.verifyOtp(user.email, '123456')).rejects.toEqual(
      new BadRequestException('Invalid or expired OTP'),
    );
    expect(redis.set).not.toHaveBeenCalledWith(
      expect.stringMatching(/^auth:password-reset:token:/),
      expect.anything(),
      'EX',
      expect.any(Number),
    );
  });

  it('rejects OTP reuse after the OTP has been consumed', async () => {
    redis.get.mockResolvedValue(null);

    await expect(service.verifyOtp(user.email, '123456')).rejects.toEqual(
      new BadRequestException('Invalid or expired OTP'),
    );
  });

  it('blocks reset requests during cooldown and rate limit windows', async () => {
    redis.ttl.mockResolvedValueOnce(30);

    await expect(service.requestOtp(user.email)).rejects.toEqual(
      new HttpException(
        'Please wait 30 seconds before requesting another OTP',
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );

    redis.ttl.mockResolvedValueOnce(-2);
    redis.incr.mockResolvedValueOnce(6);

    await expect(service.requestOtp(user.email)).rejects.toEqual(
      new HttpException('Too many OTP requests', HttpStatus.TOO_MANY_REQUESTS),
    );
  });

  it('resets the password and invalidates existing refresh sessions', async () => {
    redis.getdel.mockResolvedValue(
      JSON.stringify({ email: user.email, userId: user.id }),
    );
    redis.keys.mockResolvedValue([
      'auth:refresh:user-id:first',
      'auth:refresh:user-id:second',
    ]);

    await expect(
      service.resetPassword('reset-token', 'NewPassword123!'),
    ).resolves.toBeUndefined();

    expect(usersService.resetPasswordById).toHaveBeenCalledWith(
      user.id,
      'NewPassword123!',
    );
    expect(redis.keys).toHaveBeenCalledWith('auth:refresh:user-id:*');
    expect(redis.del).toHaveBeenCalledWith(
      'auth:refresh:user-id:first',
      'auth:refresh:user-id:second',
    );
  });

  it('blocks reset token reuse', async () => {
    redis.getdel.mockResolvedValue(null);

    await expect(
      service.resetPassword('used-token', 'NewPassword123!'),
    ).rejects.toEqual(
      new BadRequestException('Invalid or expired password reset token'),
    );
    expect(usersService.resetPasswordById).not.toHaveBeenCalled();
  });
});
